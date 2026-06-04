const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface RequestOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  // Internal: skip the automatic 401 refresh+retry (used for the refresh call itself
  // and the already-retried request) to avoid infinite recursion.
  skipAuthRetry?: boolean;
}

// Error that carries the HTTP status so callers (e.g. auth.tsx) can branch on it.
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

class ApiClient {
  private token: string | null = null;
  // De-dupes concurrent refreshes so a burst of 401s triggers a single refresh.
  private refreshPromise: Promise<boolean> | null = null;

  setToken(token: string | null) {
    this.token = token;
    // Access token kept in memory only — localStorage is readable by any XSS script
  }

  getToken(): string | null {
    return this.token;
  }

  async refreshAccessToken(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    // Collapse concurrent callers onto a single in-flight refresh.
    if (this.refreshPromise) return this.refreshPromise;

    // The refresh token itself lives in an HttpOnly cookie (invisible to JS, so
    // an XSS payload can't exfiltrate it). We only keep a non-sensitive boolean
    // hint in sessionStorage to know whether a session may exist — avoids a
    // pointless refresh call for users who never logged in this tab.
    if (!sessionStorage.getItem('arya_has_session')) return false;

    this.refreshPromise = (async () => {
      try {
        const data = await this.request<{ accessToken: string }>(
          '/admin/auth/refresh',
          // No body token — the HttpOnly cookie carries it (credentials:include).
          // skipAuthRetry: a 401 here means the session is dead — don't recurse.
          { method: 'POST', body: {}, skipAuthRetry: true },
        );
        this.token = data.accessToken;
        sessionStorage.setItem('arya_has_session', '1');
        return true;
      } catch {
        sessionStorage.removeItem('arya_has_session');
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, skipAuthRetry = false } = options;
    // Clone caller-supplied headers so a retry doesn't reuse a stale Authorization header.
    const headers: Record<string, string> = { ...(options.headers || {}) };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for cold starts / network delays

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        // Send the HttpOnly refresh cookie on auth calls (refresh/logout). The
        // backend CORS runs with an explicit origin allow-list + credentials,
        // so this is safe cross-origin.
        credentials: 'include',
      });
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === 'AbortError') {
        throw new Error('Connection timed out. The server took too long to respond.');
      }
      throw error;
    }
    clearTimeout(timeoutId);

    // Central auth recovery: on a 401 for an authenticated request, refresh the access
    // token once and retry. If refresh fails, clear auth and bounce to login.
    if (response.status === 401 && !skipAuthRetry && token) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        return this.request<T>(endpoint, { ...options, skipAuthRetry: true });
      }
      this.handleAuthFailure();
      throw new ApiError(401, 'Session expired. Please sign in again.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new ApiError(response.status, error.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) return {} as T;
    return response.json();
  }

  // Clears stored auth and redirects to login after an unrecoverable 401.
  private handleAuthFailure() {
    this.token = null;
    this.refreshPromise = null;
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('arya_has_session');
      sessionStorage.removeItem('arya_profile');
      localStorage.removeItem('arya_admin');
      // Bounce to the right login for the current area, avoiding redirect loops.
      const path = window.location.pathname;
      const loginPath = path.startsWith('/investor') ? '/investor/login' : '/login';
      if (path !== loginPath && !path.startsWith('/login') && !path.startsWith('/admin/login') && path !== '/investor/login') {
        window.location.href = loginPath;
      }
    }
  }

  // Auth
  async login(email: string, password: string) {
    const data = await this.request<{
      accessToken: string;
      refreshToken: string;
      admin: any;
    }>('/admin/auth/login', { method: 'POST', body: { email, password } });
    this.setToken(data.accessToken);
    if (typeof window !== 'undefined') {
      // Refresh token is now an HttpOnly cookie set by the server; only record
      // the non-sensitive session hint.
      sessionStorage.setItem('arya_has_session', '1');
    }
    return data;
  }

  async googleLogin(token: string) {
    const data = await this.request<{
      accessToken: string;
      refreshToken: string;
      admin: any;
    }>('/admin/auth/google/callback', { method: 'POST', body: { token } });
    this.setToken(data.accessToken);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('arya_has_session', '1');
    }
    return data;
  }

  logout() {
    if (typeof window !== 'undefined') {
      // Fire-and-forget revocation — the HttpOnly cookie carries the token
      // (credentials:include) and the server clears it. Don't block on network.
      if (sessionStorage.getItem('arya_has_session')) {
        this.request('/admin/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      }
      sessionStorage.removeItem('arya_has_session');
      sessionStorage.removeItem('arya_profile'); // clear cached user/role too
      localStorage.removeItem('arya_admin'); // legacy key cleanup
    }
    this.token = null;
  }

  // OTP Auth
  async sendOtp(email: string) {
    const res = await this.request<{ success: boolean; message: string; otp?: string }>(
      '/auth/otp/send',
      { method: 'POST', body: { email } },
    );
    // SECURITY (information disclosure): the backend may echo the OTP in the
    // response body for a hardcoded test account so the dev login UI can autofill
    // it. That value must NEVER survive into a production bundle — a network
    // observer (proxy, extension, HTTP logs) could otherwise read the code in
    // plaintext. Hard-strip it here whenever we are not in development so the
    // field is structurally absent in prod, regardless of what the server sends.
    if (process.env.NODE_ENV === 'production' && res && typeof res === 'object') {
      delete (res as { otp?: string }).otp;
    }
    return res;
  }

  async verifyOtp(email: string, otp: string) {
    const data = await this.request<{
      accessToken: string;
      refreshToken: string;
      admin: any;
    }>('/auth/otp/verify', { method: 'POST', body: { email, otp } });
    this.setToken(data.accessToken);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('arya_has_session', '1');
    }
    return data;
  }

  async getMe() {
    return this.request<any>('/admin/auth/me');
  }

  async getMyProfile() {
    return this.request<any>('/applicants/me/profile');
  }

  // WhatsApp verification — the only path that legitimately sets whatsappVerified=true
  async sendWhatsappVerifyOtp() {
    return this.request<{ success: boolean; alreadyVerified?: boolean }>(
      '/applicants/me/whatsapp/send-otp',
      { method: 'POST' },
    );
  }

  async verifyWhatsappOtp(otp: string) {
    return this.request<{ success: boolean; whatsappVerified: boolean }>(
      '/applicants/me/whatsapp/verify',
      { method: 'POST', body: { otp } },
    );
  }

  // Dashboard
  async getDashboardStats() {
    return this.request<any>('/admin/dashboard/stats');
  }

  // Questions
  async getQuestions(activeOnly = true) {
    return this.request<any[]>(`/admin/questions?activeOnly=${activeOnly}`);
  }

  async getPublicQuestions(phase = 'INITIAL') {
    return this.request<any[]>(`/questions/public?phase=${phase}`);
  }

  async createQuestion(data: any) {
    return this.request<any>('/admin/questions', { method: 'POST', body: data });
  }

  async updateQuestion(id: string, data: any) {
    return this.request<any>(`/admin/questions/${id}`, { method: 'PUT', body: data });
  }

  async deleteQuestion(id: string) {
    return this.request<any>(`/admin/questions/${id}`, { method: 'DELETE' });
  }

  // Eligibility
  async getEligibilityCriteria() {
    return this.request<any[]>('/admin/eligibility');
  }

  async createCriteria(data: any) {
    return this.request<any>('/admin/eligibility', { method: 'POST', body: data });
  }

  async updateCriteria(id: string, data: any) {
    return this.request<any>(`/admin/eligibility/${id}`, { method: 'PUT', body: data });
  }

  async deleteCriteria(id: string) {
    return this.request<any>(`/admin/eligibility/${id}`, { method: 'DELETE' });
  }

  async screenBatch(batchId: string) {
    return this.request<any>(`/admin/eligibility/screen/${batchId}`, { method: 'POST' });
  }

  // Applicants
  async getApplicants(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request<{ data: any[]; meta: any }>(`/admin/applicants?${qs}`);
  }

  async getApplicant(id: string) {
    return this.request<any>(`/admin/applicants/${id}`);
  }

  async removeApplicant(id: string) {
    return this.request<any>(`/admin/applicants/${id}`, { method: 'DELETE' });
  }

  async deleteApplicant(id: string) {
    return this.request<any>(`/admin/applicants/${id}/hard`, { method: 'DELETE' });
  }

  async updateApplicantStatus(id: string, status: string) {
    return this.request<any>(`/admin/applicants/${id}/status`, {
      method: 'PATCH',
      body: { status },
    });
  }

  async apply(data: any) {
    return this.request<any>('/applicants/apply', { method: 'POST', body: data });
  }

  async getApplicantStatus(accessToken: string) {
    return this.request<any>(`/applicants/status/${accessToken}`);
  }

  async submitDossier(data: any) {
    return this.request<any>('/applicants/dossier', { method: 'PATCH', body: data });
  }

  async getMyDossier() {
    return this.request<any>('/applicants/me/dossier');
  }

  async getMyHub() {
    return this.request<any>('/applicants/me/hub');
  }

  async createRazorpayOrder() {
    return this.request<any>('/payments/create-order', { method: 'POST' });
  }

  async submitAdditionalAnswers(accessToken: string, answers: any[]) {
    return this.request<any>(`/applicants/answers/${accessToken}`, {
      method: 'POST',
      body: { answers },
    });
  }

  async submitMyAnswers(answers: { questionId: string; value: any }[]) {
    return this.request<any>('/applicants/me/answers', {
      method: 'POST',
      body: { answers },
    });
  }

  async giveConsent(accessToken: string, consentDocUrl?: string) {
    return this.request<any>(`/applicants/consent/${accessToken}`, {
      method: 'POST',
      body: { consentDocUrl },
    });
  }

  // Batches
  async getBatches() {
    return this.request<any[]>('/admin/batches');
  }

  async getBatch(id: string) {
    return this.request<any>(`/admin/batches/${id}`);
  }

  async createBatch(data: { name: string; nickname?: string; capacity: number }) {
    return this.request<any>('/admin/batches', { method: 'POST', body: data });
  }

  async updateBatch(id: string, data: { name?: string; nickname?: string; capacity?: number }) {
    return this.request<any>(`/admin/batches/${id}`, { method: 'PUT', body: data });
  }

  async getBatchApplicants(id: string) {
    return this.request<any[]>(`/admin/batches/${id}/applicants`);
  }

  async transitionBatchStatus(id: string, status: string) {
    return this.request<any>(`/admin/batches/${id}/transition`, {
      method: 'PUT',
      body: { status },
    });
  }

  async sendBatchInstructions(id: string, data: {
    title: string;
    content: string;
    additionalQuestionIds?: string[];
    explanation?: string;
    deadline?: string;
  }) {
    return this.request<any>(`/admin/batches/${id}/instructions`, {
      method: 'POST',
      body: data,
    });
  }

  async removeNonResponders(batchId: string, instructionId: string) {
    return this.request<any>(`/admin/batches/${batchId}/remove-non-responders`, {
      method: 'POST',
      body: { instructionId },
    });
  }

  async approveBatch(id: string) {
    return this.request<any>(`/admin/batches/${id}/approve`, { method: 'POST' });
  }

  async getCurrentBatch() {
    return this.request<any>('/batches/current');
  }

  async getPublicBatchStatus(batchNumber: number) {
    return this.request<any>(`/batches/${batchNumber}/status`);
  }

  // Public, safe-field list of all batches (for the Archives page).
  async getPublicBatches() {
    return this.request<any[]>('/batches/public');
  }

  // Teams
  async getTeamsByBatch(batchId: string) {
    return this.request<any[]>(`/admin/teams/batch/${batchId}`);
  }

  async getTeam(id: string) {
    return this.request<any>(`/admin/teams/${id}`);
  }

  async formTeams(batchId: string) {
    return this.request<any>(`/admin/teams/form/${batchId}`, { method: 'POST' });
  }

  // Team lifecycle (admin): TRAINING pause / reactivate / remove.
  async moveTeamToTraining(teamId: string, reason: string) {
    return this.request<any>(`/admin/teams/${teamId}/training`, { method: 'PUT', body: { reason } });
  }

  async reactivateTeam(teamId: string) {
    return this.request<any>(`/admin/teams/${teamId}/reactivate`, { method: 'PUT' });
  }

  async removeTeam(teamId: string) {
    return this.request<any>(`/admin/teams/${teamId}`, { method: 'DELETE' });
  }

  // Smart Matching (Phase 2)
  async previewMatch(batchId: string, config?: any) {
    return this.request<any>(`/admin/matching/preview/${batchId}`, { method: 'POST', body: config });
  }

  async executeMatch(batchId: string, config?: any) {
    return this.request<any>(`/admin/matching/execute/${batchId}`, { method: 'POST', body: config });
  }

  async moveTeamMember(applicantId: string, targetTeamId: string) {
    return this.request<any>(`/admin/matching/move-member`, {
      method: 'PATCH',
      body: { applicantId, targetTeamId },
    });
  }

  async getMatchingProfiles(batchId: string) {
    return this.request<any[]>(`/admin/matching/profiles/${batchId}`);
  }

  // Investors (Phase 2)
  async registerInvestor(data: any) {
    return this.request<any>('/investors/register', { method: 'POST', body: data });
  }

  async getStartupShowcases() {
    return this.request<any[]>('/investors/showcases');
  }

  // Meeting request (investor portal): the investor identity is derived from the
  // JWT server-side — no investorId arg/param. POST /investors/meeting-request.
  async requestMeeting(data: { showcaseId: string; message?: string }) {
    return this.request<any>('/investors/meeting-request', { method: 'POST', body: data });
  }

  // ─── Investor Portal (role INVESTOR) ──────────────────────

  // Investor email+password login → JWT with role INVESTOR (only once approved).
  async investorLogin(email: string, password: string) {
    return this.request<any>('/investors/login', { method: 'POST', body: { email, password } });
  }

  async getInvestorMe() {
    return this.request<any>('/investors/me');
  }

  async getInvestorShowcases() {
    return this.request<any[]>('/investors/showcases');
  }

  async getMyMeetingRequests() {
    return this.request<any[]>('/investors/me/meeting-requests');
  }

  // ─── Investor Admin ───────────────────────────────────────

  async getInvestors(isApproved?: boolean) {
    const qs = isApproved !== undefined ? `?isApproved=${isApproved}` : '';
    return this.request<any[]>(`/admin/investors${qs}`);
  }

  async getInvestorDetail(id: string) {
    return this.request<any>(`/admin/investors/${id}`);
  }

  async approveInvestor(id: string) {
    return this.request<any>(`/admin/investors/${id}/approve`, { method: 'PATCH' });
  }

  async createShowcase(data: any) {
    return this.request<any>('/admin/showcases', { method: 'POST', body: data });
  }

  async updateShowcase(id: string, data: any) {
    return this.request<any>(`/admin/showcases/${id}`, { method: 'PATCH', body: data });
  }

  async getMeetingRequests(params: { showcaseId?: string; investorId?: string } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][],
    ).toString();
    return this.request<any[]>(`/admin/meeting-requests${qs ? `?${qs}` : ''}`);
  }

  async updateMeetingStatus(id: string, status: 'ACCEPTED' | 'DECLINED' | 'COMPLETED', scheduledAt?: string) {
    return this.request<any>(`/admin/meeting-requests/${id}/status`, {
      method: 'PATCH',
      body: { status, scheduledAt },
    });
  }

  // Support / Contributions (Phase 2)
  async createSupportOrder(data: { amount: number; isAnonymous: boolean; donorName?: string; donorEmail?: string }) {
    return this.request<any>('/support/create-order', { method: 'POST', body: data });
  }

  async getSupportStats() {
    return this.request<any>('/support/stats');
  }

  // Training (Phase 2)
  async getTrainingModules() {
    return this.request<any[]>('/admin/training/modules');
  }

  async createTrainingModule(data: any) {
    return this.request<any>('/admin/training/modules', { method: 'POST', body: data });
  }

  async assignTraining(data: { moduleId: string; applicantId: string; requiredBy?: string }) {
    return this.request<any>('/admin/training/assign', { method: 'POST', body: data });
  }

  async bulkAssignTraining(data: { moduleId: string; batchId?: string; requiredBy?: string }) {
    return this.request<any>('/admin/training/assign-bulk', { method: 'POST', body: data });
  }

  async getMyTrainingAssignments() {
    return this.request<any[]>('/training/my-assignments');
  }

  async completeTrainingAssignment(assignmentId: string, data?: { answers: any }) {
    return this.request<any>(`/training/assignments/${assignmentId}/complete`, { method: 'PATCH', body: data });
  }

  // Analytics (Phase 2)
  async getAnalyticsOverview() {
    return this.request<any>('/admin/analytics/overview');
  }

  async getBatchAnalytics(batchId: string) {
    return this.request<any>(`/admin/analytics/batch/${batchId}`);
  }

  async getTeamRankings() {
    return this.request<any[]>('/admin/analytics/rankings');
  }

  async getTeamReport(teamId: string) {
    return this.request<any>(`/admin/analytics/team/${teamId}/report`);
  }

  // Chat (Phase 2)
  async getChatRoom(teamId: string) {
    return this.request<any>(`/chat/room/team/${teamId}`);
  }

  async getUploadUrl(fileName: string, mimeType: string) {
    return this.request<any>('/documents/upload-url', {
      method: 'POST',
      body: { fileName, mimeType },
    });
  }

  // ─── Team Requests & Leader Actions ────────────────

  async createTeamRequest(teamId: string, data: { type: string; title: string; details: string }) {
    return this.request<any>(`/teams/${teamId}/requests`, { method: 'POST', body: data });
  }

  async getTeamRequests(teamId: string, status?: string) {
    const qs = status ? `?status=${status}` : '';
    return this.request<any[]>(`/teams/${teamId}/requests${qs}`);
  }

  async resolveTeamRequest(teamId: string, reqId: string, status: string) {
    return this.request<any>(`/teams/${teamId}/requests/${reqId}`, {
      method: 'PATCH',
      body: { status }
    });
  }

  async updateTeamProject(teamId: string, data: any) {
    return this.request<any>(`/teams/${teamId}/project`, { method: 'PATCH', body: data });
  }

  // ─── Elections ──────────────────────────────────────

  async startElection(teamId: string, data?: { instructions?: string; deadline?: string; questionIds?: string[] }) {
    return this.request<any>(`/admin/elections/team/${teamId}/start`, { method: 'POST', body: data || {} });
  }

  async startBatchElections(batchId: string, data?: { instructions?: string; deadline?: string; questionIds?: string[] }) {
    return this.request<any>(`/admin/elections/batch/${batchId}/start`, { method: 'POST', body: data || {} });
  }

  async getActiveElection(teamId: string) {
    return this.request<any>(`/elections/team/${teamId}/active`);
  }

  async getElection(id: string) {
    return this.request<any>(`/elections/${id}`);
  }

  async nominate(electionId: string, nomineeId: string, reason?: string) {
    return this.request<any>(`/elections/${electionId}/nominate`, {
      method: 'POST',
      body: { nomineeId, reason }
    });
  }

  async selfNominate(electionId: string, pitch?: string, answers?: { questionId: string; value: any }[]) {
    return this.request<any>(`/elections/${electionId}/self-nominate`, {
      method: 'POST',
      body: { pitch, answers }
    });
  }

  async getNominees(electionId: string) {
    return this.request<any[]>(`/elections/${electionId}/nominees`);
  }

  async submitElectionPitch(electionId: string, pitch: string) {
    return this.request<any>(`/elections/${electionId}/pitch`, {
      method: 'PUT',
      body: { pitch }
    });
  }

  async castVote(electionId: string, nomineeId: string) {
    return this.request<any>(`/elections/${electionId}/vote`, {
      method: 'POST',
      body: { nomineeId }
    });
  }

  async advanceElection(electionId: string) {
    return this.request<any>(`/admin/elections/${electionId}/advance`, { method: 'PUT' });
  }

  async getElectionResults(electionId: string) {
    return this.request<any>(`/elections/${electionId}/results`);
  }

  // Election Question Templates
  async getElectionQuestionTemplates() {
    return this.request<any[]>('/admin/election-questions/templates');
  }

  async createElectionQuestionTemplate(data: { label: string; helpText?: string; type?: string; options?: any; isRequired?: boolean }) {
    return this.request<any>('/admin/election-questions/templates', { method: 'POST', body: data });
  }

  async deleteElectionQuestionTemplate(id: string) {
    return this.request<any>(`/admin/election-questions/templates/${id}`, { method: 'DELETE' });
  }

  async addElectionCustomQuestion(electionId: string, data: { label: string; helpText?: string; type?: string; options?: any; isRequired?: boolean; sortOrder?: number }) {
    return this.request<any>(`/admin/elections/${electionId}/questions`, { method: 'POST', body: data });
  }

  // ─── Announcements ──────────────────────────────────

  async getAnnouncements(batchId?: string) {
    const qs = batchId ? `?batchId=${batchId}` : '';
    return this.request<any[]>(`/admin/announcements${qs}`);
  }

  async createAnnouncement(data: { batchId?: string; title: string; content: string; deadline?: string; sendEmail?: boolean }) {
    return this.request<any>('/admin/announcements', { method: 'POST', body: data });
  }

  async updateAnnouncement(id: string, data: { title?: string; content?: string; deadline?: string; isActive?: boolean }) {
    return this.request<any>(`/admin/announcements/${id}`, { method: 'PUT', body: data });
  }

  async deleteAnnouncement(id: string) {
    return this.request<any>(`/admin/announcements/${id}`, { method: 'DELETE' });
  }

  async getActiveAnnouncements(batchId?: string) {
    const qs = batchId ? `?batchId=${batchId}` : '';
    return this.request<any[]>(`/announcements/active${qs}`);
  }

  // ─── Documents ──────────────────────────────────────

  async confirmUpload(documentId: string, fileSize?: number) {
    return this.request<any>(`/documents/${documentId}/confirm`, {
      method: 'POST',
      body: { fileSize },
    });
  }

  async getApplicantDocuments(applicantId: string) {
    return this.request<any[]>(`/admin/documents/applicant/${applicantId}`);
  }

  async verifyDocument(documentId: string) {
    return this.request<any>(`/admin/documents/${documentId}/verify`, { method: 'POST' });
  }

  // Site Settings
  async getPublicSettings() {
    return this.request<Record<string, string>>('/settings/public');
  }

  async getSettings() {
    return this.request<Record<string, string>>('/admin/settings');
  }

  async updateSettings(data: Record<string, string>) {
    return this.request<{ success: boolean }>('/admin/settings', { method: 'PATCH', body: data });
  }

  // Visitor Analytics
  async getVisitorSummary(days = 30) {
    return this.request<any>(`/admin/settings/visitors/summary?days=${days}`);
  }

  async getVisitorPageViews(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request<{ data: any[]; meta: any }>(`/admin/settings/visitors/pageviews?${qs}`);
  }

  // DPDP Act 2023 (data minimisation): the analytics payload carries ONLY the
  // opaque applicantId for server-side attribution — never the applicant's email
  // or name. The server already has those keyed to applicantId, so sending PII on
  // every page navigation would exceed the minimum necessary data.
  async trackPageView(data: { sessionId: string; path: string; referrer?: string; screenWidth?: number; screenHeight?: number; language?: string; applicantId?: string }) {
    return this.request<void>('/track/pageview', { method: 'POST', body: data });
  }

  // ─── Member Profile (Hub) ──────────────────────────

  async getMemberProfile(memberId: string) {
    return this.request<any>(`/applicants/${memberId}/profile`);
  }

  async getPendingQuestionnaires() {
    return this.request<{ instructions: any[] }>('/applicants/me/pending-questions');
  }

  async getBatchTeams(batchId: string) {
    return this.request<any[]>(`/admin/teams/batch/${batchId}`);
  }

  // ─── Danger Zone ──────────────────────────────────────────

  async getDangerZoneTables() {
    return this.request<{ table_name: string; row_count: number }[]>('/admin/danger-zone/tables');
  }

  async truncateTable(tableName: string) {
    return this.request<{ success: boolean; message: string }>(`/admin/danger-zone/truncate/${tableName}`, { method: 'POST' });
  }

  async truncateAllTables() {
    return this.request<{ success: boolean; message: string }>('/admin/danger-zone/truncate-all', { method: 'POST' });
  }

  async getDangerZoneTableData(tableName: string) {
    return this.request<any>(`/admin/danger-zone/tables/${tableName}/data`);
  }

  async deleteDangerZoneRow(tableName: string, pkColumn: string, id: string) {
    return this.request<any>(`/admin/danger-zone/tables/${tableName}/rows?pkColumn=${encodeURIComponent(pkColumn)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async clearDangerZoneColumn(tableName: string, columnName: string) {
    return this.request<any>(`/admin/danger-zone/tables/${tableName}/columns/${encodeURIComponent(columnName)}`, { method: 'DELETE' });
  }

  // ─── Team Department Management ───────────────────────────

  async getTeamDepartments(teamId: string) {
    return this.request<{
      slots: Array<{ department: string; member: any | null }>;
      filledCount: number;
      totalRequired: number;
      isComplete: boolean;
    }>(`/teams/${teamId}/departments`);
  }

  async claimDepartment(teamId: string, department: string) {
    return this.request<any>(`/teams/${teamId}/my-department`, {
      method: 'PATCH',
      body: { department },
    });
  }

  async lockTeam(teamId: string) {
    return this.request<any>(`/admin/teams/${teamId}/lock`, { method: 'POST' });
  }

  async adminResolveTeamRequest(reqId: string, status: 'APPROVED' | 'REJECTED') {
    return this.request<any>(`/admin/teams/requests/${reqId}/resolve`, {
      method: 'PATCH',
      body: { status },
    });
  }

  // ─── Interview Scheduling ──────────────────────────────────

  async createInterviewSlot(data: {
    batchId: string;
    startTime: string;
    endTime: string;
    capacity: number;
    notes?: string;
  }) {
    return this.request<any>('/admin/interview/slots', { method: 'POST', body: data });
  }

  async getAdminInterviewSlots(batchId: string) {
    return this.request<any[]>(`/admin/interview/slots/${batchId}`);
  }

  async deleteInterviewSlot(slotId: string) {
    return this.request<any>(`/admin/interview/slots/${slotId}`, { method: 'DELETE' });
  }

  async recordInterviewDecision(bookingId: string, data: { decision: string; score?: number; notes?: string }) {
    return this.request<any>(`/admin/interview/bookings/${bookingId}/decision`, {
      method: 'PATCH',
      body: data,
    });
  }

  async getVideoSubmissions(batchId: string) {
    return this.request<any[]>(`/admin/interview/video/${batchId}`);
  }

  async reviewVideoSubmission(submissionId: string, data: { score: number; reviewNotes?: string }) {
    return this.request<any>(`/admin/interview/video/${submissionId}/score`, {
      method: 'PATCH',
      body: data,
    });
  }

  async getAvailableInterviewSlots(batchId: string) {
    return this.request<any[]>(`/interview/slots/${batchId}`);
  }

  async getMyInterviewBooking() {
    return this.request<any>('/interview/my-booking');
  }

  async bookInterviewSlot(slotId: string) {
    return this.request<any>(`/interview/book/${slotId}`, { method: 'POST' });
  }

  async cancelInterviewBooking() {
    return this.request<any>('/interview/booking', { method: 'DELETE' });
  }

  async getMyVideoSubmission() {
    return this.request<any>('/interview/video');
  }

  async submitVideoSubmission(data: { videoUrl1?: string; videoUrl2?: string; videoUrl3?: string }) {
    return this.request<any>('/interview/video', { method: 'POST', body: data });
  }

  // ─── Referral System ──────────────────────────────────

  async verifyReferrer(query: string) {
    return this.request<{ found: boolean; referrerId: string | null; name: string | null; method: string | null }>('/referrals/verify', {
      method: 'POST',
      body: { query },
    });
  }

  async setReferrer(referrerId: string) {
    return this.request<{ success: boolean }>('/referrals/set', {
      method: 'POST',
      body: { referrerId },
    });
  }

  async enableAffiliate() {
    return this.request<{ referralCode: string; referralLink: string; alreadyEnabled: boolean }>('/referrals/enable-affiliate', {
      method: 'POST',
    });
  }

  async getMyReferralProfile() {
    return this.request<any>('/referrals/my-profile');
  }

  async getAdminReferralStats() {
    return this.request<any>('/admin/referrals/stats');
  }

  async getAdminReferrals(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request<{ data: any[]; meta: any }>(`/admin/referrals?${qs}`);
  }

  async getAffiliateDetail(applicantId: string) {
    return this.request<any>(`/admin/referrals/affiliate/${applicantId}`);
  }

  async toggleAffiliateStatus(applicantId: string, isActive: boolean) {
    return this.request<any>(`/admin/referrals/affiliate/${applicantId}/toggle`, {
      method: 'PATCH',
      body: { isActive },
    });
  }

  // ─── Equity & Company System ──────────────────────────────

  async getEquityStats() {
    return this.request<any>('/admin/equity/stats');
  }

  async getEquityCompanies(params: Record<string, string> = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request<{ data: any[]; meta: any }>(`/admin/equity/companies?${qs}`);
  }

  async getEquityCompanyDetail(companyId: string) {
    return this.request<any>(`/admin/equity/companies/${companyId}`);
  }

  async createEquityCompany(body: {
    teamId: string;
    companyName: string;
    sector?: string;
    description?: string;
    registrationNumber?: string;
    registeredAddress?: string;
    gstin?: string;
    panNumber?: string;
    notes?: string;
  }) {
    return this.request<any>('/admin/equity/companies', {
      method: 'POST',
      body,
    });
  }

  async updateEquityCompany(companyId: string, body: Record<string, any>) {
    return this.request<any>(`/admin/equity/companies/${companyId}`, {
      method: 'PATCH',
      body,
    });
  }

  async startEquityTimer(companyId: string) {
    return this.request<any>(`/admin/equity/companies/${companyId}/start-timer`, { method: 'POST' });
  }

  async executeHandover(companyId: string) {
    return this.request<any>(`/admin/equity/companies/${companyId}/handover`, {
      method: 'POST',
      body: { confirm: true },
    });
  }

  // Handover dual-approval (admin + assigned co-founder) gating the 1000-day handover
  async getHandoverApprovals(companyId: string) {
    return this.request<{
      admin: { approverId: string; note?: string; createdAt: string } | null;
      coFounder: { approverId: string; note?: string; createdAt: string } | null;
      adminApproved: boolean;
      coFounderApproved: boolean;
      fullyApproved: boolean;
    }>(`/admin/equity/companies/${companyId}/handover-approvals`);
  }

  async approveHandoverAsAdmin(companyId: string, note?: string) {
    return this.request<any>(`/admin/equity/companies/${companyId}/handover-approval`, {
      method: 'POST',
      body: { note },
    });
  }

  async updateEquityTimers() {
    return this.request<any>('/admin/equity/update-timers', { method: 'POST' });
  }

  // Founder vesting (admin): recompute from the schedule, or override one holder.
  async recomputeVesting(companyId: string) {
    return this.request<any>(`/admin/equity/companies/${companyId}/recompute-vesting`, { method: 'POST' });
  }

  async setHolderVesting(holderId: string, vestedPct: number) {
    return this.request<any>(`/admin/equity/holders/${holderId}/vesting`, { method: 'PATCH', body: { vestedPct } });
  }

  async createEquityAgreement(body: {
    companyId: string;
    agreementType: string;
    title: string;
    equityPct?: number;
    duration?: number;
    terms?: any;
    notes?: string;
  }) {
    return this.request<any>('/admin/equity/agreements', {
      method: 'POST',
      body,
    });
  }

  async signAgreementPlatform(agreementId: string) {
    return this.request<any>(`/admin/equity/agreements/${agreementId}/sign-platform`, { method: 'POST' });
  }

  // Record a manual equity event (transfer / dilution / etc). triggeredBy is
  // pinned to the JWT server-side — never send it from the client.
  async recordEquityEvent(data: {
    companyId: string;
    eventType: string;
    fromHolder?: string;
    toHolder?: string;
    fromHolderId?: string;
    toHolderId?: string;
    percentageAmount: number;
    description: string;
    metadata?: any;
  }) {
    return this.request<any>('/admin/equity/events', { method: 'POST', body: data });
  }

  // ─── Notifications (admin) ────────────────────────────────

  async listNotifications(params: {
    applicantId?: string;
    status?: string;
    type?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<any>(`/admin/notifications${qs ? `?${qs}` : ''}`);
  }

  async resendNotification(id: string) {
    return this.request<any>(`/admin/notifications/${id}/resend`, { method: 'POST' });
  }

  // ─── Sprints (admin) ──────────────────────────────────────

  // Read a team's current sprint via the NON-admin founder-facing endpoint
  // (GET /sprints/team/:teamId — requires a member/founder token, NOT an admin
  // prefix). For the admin-token equivalent use adminGetSprintByTeam() which hits
  // GET /admin/sprints/team/:teamId.
  async getSprintByTeamId(teamId: string) {
    return this.request<any>(`/sprints/team/${teamId}`);
  }

  // DEPRECATED: prefer the typed adminCreateSprint(). Kept because AdminTeamControls
  // still calls this; both target POST /admin/sprints, so a path change must be
  // mirrored in adminCreateSprint() below until this is migrated away.
  async createSprint(data: any) {
    return this.request<any>('/admin/sprints', { method: 'POST', body: data });
  }

  // DEPRECATED: prefer the typed adminCreateMilestone(). Same backend route
  // (POST /admin/sprints/:sprintId/milestones); retained for AdminTeamControls.
  async createMilestone(sprintId: string, data: any) {
    return this.request<any>(`/admin/sprints/${sprintId}/milestones`, { method: 'POST', body: data });
  }

  async createBulkCommonMilestone(data: any) {
    return this.request<any>('/admin/sprints/milestones/bulk-common', { method: 'POST', body: data });
  }

  async completeSprint(sprintId: string) {
    return this.request<any>(`/admin/sprints/${sprintId}/complete`, { method: 'PATCH' });
  }

  // ─── Documents (admin) ────────────────────────────────────

  // Returns the presigned download URL payload as provided by the endpoint.
  async downloadDocument(id: string) {
    return this.request<any>(`/admin/documents/${id}/download`);
  }

  // ─── Training (admin) ─────────────────────────────────────

  async updateTrainingModule(id: string, data: any) {
    return this.request<any>(`/admin/training/modules/${id}`, { method: 'PATCH', body: data });
  }

  async deleteTrainingModule(id: string) {
    return this.request<any>(`/admin/training/modules/${id}`, { method: 'DELETE' });
  }

  async getTrainingStats() {
    return this.request<any>('/admin/training/stats');
  }

  // Assignments are scoped per module: GET /admin/training/assignments/:moduleId
  async getTrainingAssignments(moduleId: string) {
    return this.request<any[]>(`/admin/training/assignments/${moduleId}`);
  }

  // ─── Donations (admin) ────────────────────────────────────

  async getAdminDonations(params: { page?: number; limit?: number; status?: string } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(`/admin/support${qs ? `?${qs}` : ''}`);
  }

  // ─── Chat (admin) ─────────────────────────────────────────

  // Sender identity/name come from the JWT server-side; only content is sent.
  async sendChatAnnouncement(data: { content: string }) {
    return this.request<any>('/admin/chat/announcement', { method: 'POST', body: data });
  }

  // ─── Elections (admin) ────────────────────────────────────

  // Add a custom question to a specific election. POST /admin/elections/:id/questions
  async createElectionQuestions(electionId: string, data: {
    label: string;
    helpText?: string;
    type?: string;
    options?: any;
    isRequired?: boolean;
    sortOrder?: number;
  }) {
    return this.request<any>(`/admin/elections/${electionId}/questions`, { method: 'POST', body: data });
  }

  // ─── Eligibility (admin) ──────────────────────────────────

  async evaluateApplicant(applicantId: string) {
    return this.request<any>(`/admin/eligibility/evaluate/${applicantId}`);
  }

  // ─── Questions (admin) ────────────────────────────────────

  async reorderQuestions(items: { id: string; sortOrder: number }[]) {
    return this.request<any>('/admin/questions/reorder', { method: 'PUT', body: { items } });
  }

  // ─── Admin Accounts (SUPER_ADMIN) ─────────────────────────

  async createAdminAccount(data: any) {
    return this.request<any>('/admin/auth/create', { method: 'POST', body: data });
  }

  // ─── Settings (single-key helper) ─────────────────────────

  // The backend exposes only a bulk PATCH /admin/settings; this wraps it for a
  // single key so the consent page can update one setting at a time.
  async updateSetting(key: string, value: string) {
    return this.request<{ success: boolean }>('/admin/settings', {
      method: 'PATCH',
      body: { [key]: value },
    });
  }

  // ─── Admin: Sprint management ────────────────────────────

  async adminCreateSprint(data: { teamId: string; startDate: string; endDate: string; title?: string }) {
    return this.request<any>('/admin/sprints', { method: 'POST', body: data });
  }

  async adminGetSprintByTeam(teamId: string) {
    return this.request<any>(`/admin/sprints/team/${teamId}`);
  }

  async adminCreateMilestone(sprintId: string, data: { title: string; description?: string; deadline: string; type?: string }) {
    return this.request<any>(`/admin/sprints/${sprintId}/milestones`, { method: 'POST', body: data });
  }

  async adminCreateBulkMilestone(data: { title: string; description?: string; deadline: string }) {
    return this.request<any>('/admin/sprints/milestones/bulk-common', { method: 'POST', body: data });
  }

  async adminGetCheckInStatus(batchId: string, week?: number) {
    const qs = week !== undefined ? `?batchId=${batchId}&week=${week}` : `?batchId=${batchId}`;
    return this.request<any>(`/admin/sprints/checkins/status${qs}`);
  }

  // Sprint dashboard
  async getMySprintDashboard() {
    return this.request<any>('/sprints/my/dashboard');
  }

  async completeMilestone(milestoneId: string) {
    return this.request<any>(`/sprints/milestones/${milestoneId}/complete`, { method: 'PATCH' });
  }

  async logBlocker(teamId: string, body: { week: number; description: string; severity?: string }) {
    return this.request<any>(`/sprints/teams/${teamId}/blockers`, { method: 'POST', body });
  }

  async resolveBlocker(blockerId: string) {
    return this.request<any>(`/sprints/blockers/${blockerId}/resolve`, { method: 'PATCH' });
  }

  async submitCheckIn(teamId: string, body: { week: number; progressSummary: string }) {
    return this.request<any>(`/sprints/teams/${teamId}/checkins`, { method: 'POST', body });
  }

  // Project (founder-facing)
  async getMyProject() {
    return this.request<any>('/applicants/me/project');
  }

  async updateMyProject(teamId: string, data: {
    projectName?: string;
    targetMarket?: string;
    description?: string;
    estimatedFunds?: number;
  }) {
    return this.request<any>(`/teams/${teamId}/project`, { method: 'PATCH', body: data });
  }

  // ─── Resource Requests (founder-facing) ───────────────────

  async submitResourceRequest(teamId: string, body: { type: string; description: string }) {
    return this.request<any>(`/teams/${teamId}/resource-requests`, { method: 'POST', body });
  }

  async getTeamResourceRequests(teamId: string, status?: string) {
    const qs = status ? `?status=${status}` : '';
    return this.request<any[]>(`/teams/${teamId}/resource-requests${qs}`);
  }

  async getTeamBlockers(teamId: string, resolved?: boolean) {
    const qs = resolved !== undefined ? `?resolved=${resolved}` : '';
    return this.request<any[]>(`/sprints/teams/${teamId}/blockers${qs}`);
  }

  async getTeamCheckIns(teamId: string) {
    return this.request<any[]>(`/sprints/teams/${teamId}/checkins`);
  }

  // ─── Admin: Mentor management ─────────────────────────────

  async listMentors() {
    return this.request<any[]>('/admin/mentors');
  }

  async createMentor(data: { email: string; password: string; firstName: string; lastName: string; expertise?: string[]; bio?: string }) {
    return this.request<any>('/admin/mentors', { method: 'POST', body: data });
  }

  async assignMentorToTeam(mentorId: string, teamId: string) {
    return this.request<any>(`/admin/mentors/${mentorId}/assign`, { method: 'POST', body: { teamId } });
  }

  // ─── Admin: Co-Founder management ────────────────────────

  async listCoFounders() {
    return this.request<any[]>('/admin/cofounders');
  }

  async createCoFounder(data: { email: string; password: string; firstName: string; lastName: string; bio?: string }) {
    return this.request<any>('/admin/cofounders', { method: 'POST', body: data });
  }

  async assignCoFounderToTeam(coFounderId: string, teamId: string) {
    return this.request<any>(`/admin/cofounders/${coFounderId}/assign`, { method: 'POST', body: { teamId } });
  }

  async getAdminWeeklyReports(batchId?: string) {
    const qs = batchId ? `?batchId=${batchId}` : '';
    return this.request<any[]>(`/admin/cofounders/reports${qs}`);
  }

  async fulfillResourceRequest(reqId: string, notes?: string) {
    return this.request<any>(`/admin/resource-requests/${reqId}/fulfill`, { method: 'PATCH', body: { notes } });
  }

  // ─── Admin: Documentary management ───────────────────────

  async getDocumentaryUploadUrl(teamId: string, data: { fileName: string; mimeType: string; week: number; title: string; description?: string }) {
    return this.request<{ uploadUrl: string; clipId: string; key: string }>(
      `/admin/documentary/teams/${teamId}/upload-url`,
      { method: 'POST', body: data },
    );
  }

  async confirmDocumentaryUpload(clipId: string, thumbnailUrl?: string) {
    return this.request<any>(`/admin/documentary/clips/${clipId}/confirm`, { method: 'PATCH', body: { thumbnailUrl } });
  }

  async publishDocumentaryClip(clipId: string, publish: boolean) {
    return this.request<any>(`/admin/documentary/clips/${clipId}/publish`, { method: 'PATCH', body: { publish } });
  }

  async listDocumentaryClips(teamId: string) {
    return this.request<any[]>(`/admin/documentary/teams/${teamId}/clips`);
  }

  async deleteDocumentaryClip(clipId: string) {
    return this.request<any>(`/admin/documentary/clips/${clipId}`, { method: 'DELETE' });
  }

  async getDocumentaryStreamUrl(clipId: string) {
    return this.request<{ url: string; clip: any }>(`/admin/documentary/clips/${clipId}/stream-url`);
  }

  async getPublishedDocumentaryClips(teamId: string) {
    return this.request<any[]>(`/investors/documentary/${teamId}`);
  }

  async getInvestorClipStreamUrl(clipId: string) {
    return this.request<{ url: string; clip: any }>(`/documentary/clips/${clipId}/stream-url`);
  }

  // ─── Admin: Pitch events ──────────────────────────────────

  async createPitchEvent(data: { teamId: string; scheduledAt: string; venue?: string; notes?: string }) {
    return this.request<any>('/admin/pitch/events', { method: 'POST', body: data });
  }

  async listPitchEvents(teamId?: string, batchId?: string) {
    const params = new URLSearchParams();
    if (teamId) params.set('teamId', teamId);
    if (batchId) params.set('batchId', batchId);
    const qs = params.toString();
    return this.request<any[]>(`/admin/pitch/events${qs ? `?${qs}` : ''}`);
  }

  async updatePitchEventStatus(id: string, status: string) {
    return this.request<any>(`/admin/pitch/events/${id}/status`, { method: 'PATCH', body: { status } });
  }

  async recordInvestorInterest(pitchEventId: string, data: { investorId: string; status: string; notes?: string }) {
    return this.request<any>(`/admin/pitch/events/${pitchEventId}/interest`, { method: 'POST', body: data });
  }

  async recordFundingDecision(pitchEventId: string, data: { investorId: string; outcome: string; amount?: number; notes?: string }) {
    return this.request<any>(`/admin/pitch/events/${pitchEventId}/funding`, { method: 'POST', body: data });
  }

  // Alias of getInvestors (kept for the pitch-events call sites that import this
  // name). Delegates so the GET /admin/investors path is defined in exactly one
  // place — DRY: a path change only has to land in getInvestors.
  async getAdminInvestors(isApproved?: boolean) {
    return this.getInvestors(isApproved);
  }

  // ─── Admin: WhatsApp ──────────────────────────────────────

  async getWhatsappTemplates() {
    return this.request<any[]>('/admin/whatsapp/templates');
  }

  async whatsappBroadcast(data: { title: string; message: string; batchId?: string; teamId?: string }) {
    return this.request<{ attempted: number; succeeded: number; failed: number }>(
      '/admin/whatsapp/broadcast',
      { method: 'POST', body: data },
    );
  }

  async getWhatsappSendLog(limit = 50, offset = 0) {
    return this.request<any[]>(`/admin/whatsapp/send-log?limit=${limit}&offset=${offset}`);
  }

  async whatsappSendOne(data: { phone: string; templateName: string; parameters: string[] }) {
    return this.request<{ sent: boolean }>('/admin/whatsapp/send', { method: 'POST', body: data });
  }

  // ════════════════════════════════════════════════════════════════════════
  // STORE ADMIN (platform admin token) — SpaceKart commerce back-office.
  //
  // Every store admin route has the sub-path `admin/store/*`. The controllers use
  // the `@Controller('api')` prefix and carry the FULL sub-path on each route
  // decorator (e.g. `@Get('admin/store/products')`), not a `@Controller('api/admin/store')`
  // prefix. API_BASE already ends in `/api`, so the endpoints below omit the
  // leading `/api`. NOTE: a few inventory reads live under `admin/store/stock/*`
  // (movements, reorder) rather than `admin/store/inventory/*` — see the backend
  // InventoryController; the mismatch is intentional, not a typo.
  //
  // Money is ALWAYS integer paise in both directions — format to rupees in the UI.
  // Request bodies for create/update routes are typed loosely (Record / any) where
  // the backend DTO is large; the load-bearing path + key fields are pinned.
  // ════════════════════════════════════════════════════════════════════════

  // ─── Store Admin: Products ────────────────────────────────────────────────

  /**
   * Admin product LIST — returns products of ALL statuses (DRAFT/ACTIVE/ARCHIVED),
   * unlike the public `storeApi.listProducts` (ACTIVE-only). Each row carries a
   * presigned `thumbnail` ({ url, altText } | null). Money is integer paise.
   */
  async adminListProducts(
    params: {
      status?: string;
      search?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/products${qs ? `?${qs}` : ''}`,
    );
  }

  async adminGetStoreProduct(id: string) {
    return this.request<any>(`/admin/store/products/${id}`);
  }

  async adminCreateStoreProduct(data: {
    name: string;
    subtitle?: string;
    brand?: string;
    shortDescription?: string;
    status?: string;
    type?: string;
    categoryId?: string | null;
    tags?: string[];
    isFeatured?: boolean;
    sortOrder?: number;
    seoTitle?: string;
    seoDescription?: string;
    [k: string]: any;
  }) {
    return this.request<any>('/admin/store/products', { method: 'POST', body: data });
  }

  async adminUpdateStoreProduct(id: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/products/${id}`, { method: 'PATCH', body: data });
  }

  /** Archive (soft-delete) a product. */
  async adminArchiveStoreProduct(id: string) {
    return this.request<any>(`/admin/store/products/${id}`, { method: 'DELETE' });
  }

  // ─── Store Admin: SKUs + price tiers ──────────────────────────────────────

  async adminCreateSku(productId: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/products/${productId}/skus`, {
      method: 'POST',
      body: data,
    });
  }

  async adminUpdateSku(skuId: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/skus/${skuId}`, { method: 'PATCH', body: data });
  }

  async adminAddPriceTier(skuId: string, data: { minQty: number; unitPrice: number; [k: string]: any }) {
    return this.request<any>(`/admin/store/skus/${skuId}/price-tiers`, {
      method: 'POST',
      body: data,
    });
  }

  /**
   * SKU typeahead for the admin SkuPicker — searches skuCode / name / productName
   * (case-insensitive) and returns a lightweight projection. `limit` is clamped
   * server-side (1–50). Powers SkuPicker in the inventory + purchasing forms,
   * replacing raw SKU-UUID text entry.
   */
  async adminSearchSkus(search: string, limit?: number) {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    return this.request<{ id: string; skuCode: string; name: string | null; productName: string | null }[]>(
      `/admin/store/skus${qs ? `?${qs}` : ''}`,
    );
  }

  // ─── Store Admin: Product media ───────────────────────────────────────────

  async adminPresignProductMedia(productId: string, data: { fileName: string; mimeType: string; [k: string]: any }) {
    return this.request<any>(`/admin/store/products/${productId}/media/presign`, {
      method: 'POST',
      body: data,
    });
  }

  async adminConfirmProductMedia(productId: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/products/${productId}/media/confirm`, {
      method: 'POST',
      body: data,
    });
  }

  async adminListProductMedia(productId: string, confirmedOnly?: boolean) {
    const qs = confirmedOnly !== undefined ? `?confirmedOnly=${confirmedOnly}` : '';
    return this.request<any[]>(`/admin/store/products/${productId}/media${qs}`);
  }

  async adminDeleteProductMedia(productId: string, mediaId: string) {
    return this.request<any>(`/admin/store/products/${productId}/media/${mediaId}`, {
      method: 'DELETE',
    });
  }

  // ─── Store Admin: Tabs ────────────────────────────────────────────────────

  /** Replace the product's editorial tab set (PUT — full upsert). */
  async adminUpsertProductTabs(productId: string, data: { tabs: any[]; [k: string]: any }) {
    return this.request<any>(`/admin/store/products/${productId}/tabs`, {
      method: 'PUT',
      body: data,
    });
  }

  // ─── Store Admin: Categories ──────────────────────────────────────────────

  async adminGetStoreCategoryTree() {
    return this.request<any[]>('/admin/store/categories');
  }

  async adminCreateStoreCategory(data: { name: string; slug?: string; parentId?: string | null; [k: string]: any }) {
    return this.request<any>('/admin/store/categories', { method: 'POST', body: data });
  }

  async adminUpdateStoreCategory(id: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/categories/${id}`, { method: 'PATCH', body: data });
  }

  /** Delete a category; pass confirm=true to force when it has children/products. */
  async adminDeleteStoreCategory(id: string, confirm = false) {
    const qs = confirm ? '?confirm=true' : '';
    return this.request<any>(`/admin/store/categories/${id}${qs}`, { method: 'DELETE' });
  }

  // ─── Store Admin: Sections (catalog tax classes live under tax admin) ──────
  // NOTE: "sections" on a product are the editorial tabs handled by
  // adminUpsertProductTabs above; there is no separate /sections route.

  // ─── Store Admin: DIY guides + bundles ────────────────────────────────────

  /** Upsert a product's DIY guide (BOM + steps). Returns { created, guide }. */
  async adminUpsertDiyGuide(productId: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/products/${productId}/diy`, {
      method: 'POST',
      body: data,
    });
  }

  /** Create a sellable component bundle (its own SKU + BOM). */
  async adminCreateBundle(data: Record<string, any>) {
    return this.request<any>('/admin/store/bundles', { method: 'POST', body: data });
  }

  // ─── Store Admin: Inventory — warehouses ──────────────────────────────────

  async adminListWarehouses(includeInactive?: boolean) {
    const qs = includeInactive ? '?includeInactive=true' : '';
    return this.request<any[]>(`/admin/store/warehouses${qs}`);
  }

  async adminGetWarehouse(id: string) {
    return this.request<any>(`/admin/store/warehouses/${id}`);
  }

  async adminCreateWarehouse(data: { code: string; name: string; [k: string]: any }) {
    return this.request<any>('/admin/store/warehouses', { method: 'POST', body: data });
  }

  async adminUpdateWarehouse(id: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/warehouses/${id}`, { method: 'PATCH', body: data });
  }

  async adminDeactivateWarehouse(id: string) {
    return this.request<any>(`/admin/store/warehouses/${id}/deactivate`, { method: 'PATCH' });
  }

  // ─── Store Admin: Inventory — stock ───────────────────────────────────────

  /** Stock matrix (SKU × warehouse): on-hand / reserved / available. */
  async adminGetStockMatrix(params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<any>(`/admin/store/inventory${qs ? `?${qs}` : ''}`);
  }

  async adminGetSkuInventory(skuId: string) {
    return this.request<any>(`/admin/store/inventory/${skuId}`);
  }

  // Path is `admin/store/stock/movements` (NOT `.../inventory/movements`) — this
  // matches the backend InventoryController route exactly; do not "normalise" it.
  async adminListStockMovements(params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<any>(`/admin/store/stock/movements${qs ? `?${qs}` : ''}`);
  }

  async adminGetReorderReport(warehouseId?: string) {
    const qs = warehouseId ? `?warehouseId=${warehouseId}` : '';
    return this.request<any>(`/admin/store/stock/reorder${qs}`);
  }

  /** Manual stock adjustment (audited; ADMIN/SUPER_ADMIN only). */
  async adminAdjustStock(data: {
    skuId: string;
    warehouseId: string;
    quantityDelta: number;
    reason?: string;
    [k: string]: any;
  }) {
    return this.request<any>('/admin/store/inventory/adjust', { method: 'POST', body: data });
  }

  /** Transfer stock between warehouses (audited; ADMIN/SUPER_ADMIN only). */
  async adminTransferStock(data: {
    skuId: string;
    fromWarehouseId: string;
    toWarehouseId: string;
    quantity: number;
    reason?: string;
    [k: string]: any;
  }) {
    return this.request<any>('/admin/store/inventory/transfer', { method: 'POST', body: data });
  }

  // ─── Store Admin: Purchasing — suppliers ──────────────────────────────────

  async adminListSuppliers(params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/suppliers${qs ? `?${qs}` : ''}`,
    );
  }

  async adminGetSupplier(id: string) {
    return this.request<any>(`/admin/store/suppliers/${id}`);
  }

  async adminCreateSupplier(data: { name: string; [k: string]: any }) {
    return this.request<any>('/admin/store/suppliers', { method: 'POST', body: data });
  }

  async adminUpdateSupplier(id: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/suppliers/${id}`, { method: 'PATCH', body: data });
  }

  async adminDeactivateSupplier(id: string) {
    return this.request<any>(`/admin/store/suppliers/${id}/deactivate`, { method: 'PATCH' });
  }

  // ─── Store Admin: Purchasing — purchase orders ────────────────────────────

  async adminListPurchaseOrders(params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/purchase-orders${qs ? `?${qs}` : ''}`,
    );
  }

  async adminGetPurchaseOrder(id: string) {
    return this.request<any>(`/admin/store/purchase-orders/${id}`);
  }

  /** Create a DRAFT purchase order (supplier + line items at integer paise). */
  async adminCreatePurchaseOrder(data: {
    supplierId: string;
    warehouseId: string;
    lines: Array<{ skuId: string; orderedQty: number; unitCostPaise: number; lotNo?: number; taxBps?: number; [k: string]: any }>;
    [k: string]: any;
  }) {
    return this.request<any>('/admin/store/purchase-orders', { method: 'POST', body: data });
  }

  /** Submit (place) a DRAFT purchase order. */
  async adminSubmitPurchaseOrder(id: string) {
    return this.request<any>(`/admin/store/purchase-orders/${id}/submit`, { method: 'PATCH' });
  }

  async adminCancelPurchaseOrder(id: string) {
    return this.request<any>(`/admin/store/purchase-orders/${id}/cancel`, { method: 'PATCH' });
  }

  /** Receive PO lines into stock (full/partial; audited + idempotent server-side). */
  async adminReceivePurchaseOrder(id: string, data: {
    lines: Array<{ lineId: string; receivedQty: number; [k: string]: any }>;
    [k: string]: any;
  }) {
    return this.request<any>(`/admin/store/purchase-orders/${id}/receive`, {
      method: 'POST',
      body: data,
    });
  }

  /** Build a DRAFT PO from the reorder report (auto-reorder). */
  async adminReorderToDraftPo(warehouseId?: string) {
    const qs = warehouseId ? `?warehouseId=${warehouseId}` : '';
    return this.request<any>(`/admin/store/purchase-orders/reorder-draft${qs}`, {
      method: 'POST',
    });
  }

  // ─── Store Admin: Orders ──────────────────────────────────────────────────

  async adminListOrders(params: {
    page?: number;
    limit?: number;
    status?: string;
    paymentStatus?: string;
    search?: string;
    customerId?: string;
  } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/orders${qs ? `?${qs}` : ''}`,
    );
  }

  async adminGetOrder(id: string) {
    return this.request<any>(`/admin/store/orders/${id}`);
  }

  /** Advance an order through the validated state machine (audited). */
  async adminTransitionOrder(id: string, data: { toStatus: string; note?: string }) {
    return this.request<any>(`/admin/store/orders/${id}/transition`, {
      method: 'POST',
      body: data,
    });
  }

  /** Create a shipment for an order (manual courier+awb or active provider). */
  async adminShipOrder(id: string, data: { courier?: string; awb?: string; useProvider?: boolean; [k: string]: any }) {
    return this.request<any>(`/admin/store/orders/${id}/ship`, { method: 'POST', body: data });
  }

  /** Issue (idempotent) an order's GST tax invoice → fresh presigned download URL. */
  async adminIssueOrderInvoice(orderId: string) {
    return this.request<any>(`/admin/store/orders/${orderId}/invoice`, {
      method: 'POST',
      body: {},
    });
  }

  // ─── Store Admin: Shipping ────────────────────────────────────────────────

  async adminListShipments(params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/shipments${qs ? `?${qs}` : ''}`,
    );
  }

  // ─── Store Admin: Returns ─────────────────────────────────────────────────

  async adminListReturns(params: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/returns${qs ? `?${qs}` : ''}`,
    );
  }

  async adminGetReturn(id: string) {
    return this.request<any>(`/admin/store/returns/${id}`);
  }

  /** Approve a REQUESTED return (no money / stock moves yet). */
  async adminApproveReturn(id: string, note?: string) {
    return this.request<any>(`/admin/store/returns/${id}/approve`, {
      method: 'PATCH',
      body: { note },
    });
  }

  /** Reject a REQUESTED return with a structured reason. */
  async adminRejectReturn(id: string, data: { reason: string; note?: string }) {
    return this.request<any>(`/admin/store/returns/${id}/reject`, {
      method: 'PATCH',
      body: data,
    });
  }

  /** Mark an APPROVED return IN_TRANSIT (optional intermediate step). */
  async adminMarkReturnInTransit(id: string) {
    return this.request<any>(`/admin/store/returns/${id}/in-transit`, { method: 'PATCH' });
  }

  /** Receive a returned parcel: restock + Razorpay refund + credit note (idempotent). */
  async adminReceiveReturn(id: string, note?: string) {
    return this.request<any>(`/admin/store/returns/${id}/receive`, {
      method: 'POST',
      body: { note },
    });
  }

  // ─── Store Admin: Coupons ─────────────────────────────────────────────────

  async adminListCoupons(params: Record<string, string | number> = {}) {
    const qs = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/coupons${qs ? `?${qs}` : ''}`,
    );
  }

  async adminGetCoupon(id: string) {
    return this.request<any>(`/admin/store/coupons/${id}`);
  }

  async adminCreateCoupon(data: {
    code: string;
    type: string; // PERCENT | FIXED etc.
    value: number; // percent bps or fixed paise per backend DTO
    [k: string]: any;
  }) {
    return this.request<any>('/admin/store/coupons', { method: 'POST', body: data });
  }

  async adminUpdateCoupon(id: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/coupons/${id}`, { method: 'PATCH', body: data });
  }

  // ─── Store Admin: Tax (classes + HSN rates) ───────────────────────────────

  async adminListTaxClasses() {
    return this.request<any[]>('/admin/store/tax-classes');
  }

  async adminGetTaxClass(id: string) {
    return this.request<any>(`/admin/store/tax-classes/${id}`);
  }

  async adminCreateTaxClass(data: { name: string; [k: string]: any }) {
    return this.request<any>('/admin/store/tax-classes', { method: 'POST', body: data });
  }

  async adminUpdateTaxClass(id: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/tax-classes/${id}`, { method: 'PATCH', body: data });
  }

  async adminDeactivateTaxClass(id: string) {
    return this.request<any>(`/admin/store/tax-classes/${id}`, { method: 'DELETE' });
  }

  async adminListTaxRates() {
    return this.request<any[]>('/admin/store/tax-rates');
  }

  async adminGetTaxRate(id: string) {
    return this.request<any>(`/admin/store/tax-rates/${id}`);
  }

  /** Create-or-update a tax rate by its unique hsnCode. */
  async adminUpsertTaxRate(data: { hsnCode: string; rateBps: number; [k: string]: any }) {
    return this.request<any>('/admin/store/tax-rates', { method: 'POST', body: data });
  }

  async adminUpdateTaxRate(id: string, data: Record<string, any>) {
    return this.request<any>(`/admin/store/tax-rates/${id}`, { method: 'PATCH', body: data });
  }

  async adminDeleteTaxRate(id: string) {
    return this.request<any>(`/admin/store/tax-rates/${id}`, { method: 'DELETE' });
  }

  // ─── Store Admin: Analytics (all money fields are paise) ───────────────────

  async adminStoreAnalyticsSummary(range?: string) {
    const qs = range ? `?range=${encodeURIComponent(range)}` : '';
    return this.request<any>(`/admin/store/analytics/summary${qs}`);
  }

  async adminStoreAnalyticsRevenue(range?: string) {
    const qs = range ? `?range=${encodeURIComponent(range)}` : '';
    return this.request<any>(`/admin/store/analytics/revenue${qs}`);
  }

  async adminStoreTopProducts(params: { range?: string; limit?: number } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<any>(`/admin/store/analytics/top-products${qs ? `?${qs}` : ''}`);
  }

  async adminStoreLowStock(params: { page?: number; limit?: number; warehouseId?: string } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<any>(`/admin/store/analytics/low-stock${qs ? `?${qs}` : ''}`);
  }

  async adminStoreReturnsRate(range?: string) {
    const qs = range ? `?range=${encodeURIComponent(range)}` : '';
    return this.request<any>(`/admin/store/analytics/returns-rate${qs}`);
  }

  async adminStoreInventoryValue() {
    return this.request<any>('/admin/store/analytics/inventory-value');
  }

  async adminStoreInventoryHealth() {
    return this.request<any>('/admin/store/analytics/inventory-health');
  }

  // ─── Store Admin: Articles moderation ─────────────────────────────────────

  async adminListArticles(params: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/articles${qs ? `?${qs}` : ''}`,
    );
  }

  async adminGetArticle(id: string) {
    return this.request<any>(`/admin/store/articles/${id}`);
  }

  /** Approve (publish) a submitted article. decidedByAdminId is pinned server-side. */
  async adminApproveArticle(id: string) {
    return this.request<any>(`/admin/store/articles/${id}/approve`, { method: 'POST' });
  }

  async adminRejectArticle(id: string, reason: string) {
    return this.request<any>(`/admin/store/articles/${id}/reject`, {
      method: 'POST',
      body: { reason },
    });
  }

  /** Admin edit / feature / unpublish. */
  async adminUpdateArticle(id: string, data: {
    title?: string;
    body?: Record<string, unknown>;
    excerpt?: string;
    coverS3Key?: string;
    tags?: string[];
    featured?: boolean;
    unpublish?: boolean;
    [k: string]: any;
  }) {
    return this.request<any>(`/admin/store/articles/${id}`, { method: 'PATCH', body: data });
  }

  /** Restore a previously removed/soft-deleted article. */
  async adminRestoreArticle(id: string) {
    return this.request<any>(`/admin/store/articles/${id}/restore`, { method: 'POST' });
  }

  /** Hard-remove an article. */
  async adminDeleteArticle(id: string) {
    return this.request<any>(`/admin/store/articles/${id}`, { method: 'DELETE' });
  }

  // ─── Store Admin: Reviews moderation ──────────────────────────────────────
  //
  // GET  /admin/store/reviews?status=&page=&limit= (AdminGuard)
  // PATCH /admin/store/reviews/:id  { status: 'APPROVED' | 'REJECTED' }
  // On approve the backend adds the rating to Product.ratingSum/ratingCount under
  // an advisory lock + CAS (idempotent); on un-approve it subtracts. The actor is
  // pinned server-side from the JWT — never sent in the body.

  async adminListReviews(params: {
    status?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const qs = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => [k, String(v)]),
    ).toString();
    return this.request<{ data: any[]; meta: any }>(
      `/admin/store/reviews${qs ? `?${qs}` : ''}`,
    );
  }

  async adminModerateReview(id: string, status: 'APPROVED' | 'REJECTED') {
    return this.request<any>(`/admin/store/reviews/${id}`, {
      method: 'PATCH',
      body: { status },
    });
  }
}

export const api = new ApiClient();
