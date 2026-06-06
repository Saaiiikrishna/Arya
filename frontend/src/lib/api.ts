const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface RequestOptions {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
}

class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
    // Access token kept in memory only — localStorage is readable by any XSS script
  }

  getToken(): string | null {
    return this.token;
  }

  async refreshAccessToken(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const refreshToken = sessionStorage.getItem('arya_refresh');
    if (!refreshToken) return false;
    try {
      const data = await this.request<{ accessToken: string; refreshToken: string }>(
        '/admin/auth/refresh',
        { method: 'POST', body: { refreshToken } },
      );
      this.token = data.accessToken;
      sessionStorage.setItem('arya_refresh', data.refreshToken);
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {} } = options;

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for cold starts / network delays

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Request failed' }));
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      if (response.status === 204) return {} as T;
      return response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Connection timed out. The server took too long to respond.');
      }
      throw error;
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
      sessionStorage.setItem('arya_refresh', data.refreshToken);
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
      sessionStorage.setItem('arya_refresh', data.refreshToken);
    }
    return data;
  }

  logout() {
    if (typeof window !== 'undefined') {
      const rt = sessionStorage.getItem('arya_refresh');
      if (rt) {
        // Fire-and-forget revocation — don't block the local logout on network
        this.request('/admin/auth/logout', { method: 'POST', body: { refreshToken: rt } }).catch(() => {});
      }
      sessionStorage.removeItem('arya_refresh');
      localStorage.removeItem('arya_admin'); // legacy key cleanup
    }
    this.token = null;
  }

  // OTP Auth
  async sendOtp(email: string) {
    return this.request<{ success: boolean; message: string; otp?: string }>('/auth/otp/send', {
      method: 'POST',
      body: { email },
    });
  }

  async verifyOtp(email: string, otp: string) {
    const data = await this.request<{
      accessToken: string;
      refreshToken: string;
      admin: any;
    }>('/auth/otp/verify', { method: 'POST', body: { email, otp } });
    this.setToken(data.accessToken);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('arya_refresh', data.refreshToken);
    }
    return data;
  }

  async getMe() {
    return this.request<any>('/admin/auth/me');
  }

  async getMyProfile() {
    return this.request<any>('/applicants/me/profile');
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

  async requestMeeting(investorId: string, data: { showcaseId: string; date: string; message?: string }) {
    return this.request<any>(`/investors/${investorId}/meeting-request`, { method: 'POST', body: data });
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

  async trackPageView(data: { sessionId: string; path: string; referrer?: string; screenWidth?: number; screenHeight?: number; language?: string; applicantId?: string; applicantEmail?: string; applicantName?: string }) {
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
    return this.request<any>(`/admin/equity/companies/${companyId}/handover`, { method: 'POST' });
  }

  async updateEquityTimers() {
    return this.request<any>('/admin/equity/update-timers', { method: 'POST' });
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

  async getAdminInvestors(isApproved?: boolean) {
    const qs = isApproved !== undefined ? `?isApproved=${isApproved}` : '';
    return this.request<any[]>(`/admin/investors${qs}`);
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

  // ─── Homepage CMS Media ───────────────────────────────────────
  async getAdminMediaUploadUrl(fileName: string, mimeType: string) {
    return this.request<{ uploadUrl: string; publicUrl: string; key: string }>(
      '/admin/settings/media-upload-url',
      { method: 'POST', body: { fileName, mimeType } },
    );
  }
}

export const api = new ApiClient();
