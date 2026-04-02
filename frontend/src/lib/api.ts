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
    if (token) {
      if (typeof window !== 'undefined') localStorage.setItem('arya_token', token);
    } else {
      if (typeof window !== 'undefined') localStorage.removeItem('arya_token');
    }
  }

  getToken(): string | null {
    if (this.token) return this.token;
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('arya_token');
    }
    return this.token;
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
      localStorage.setItem('arya_refresh', data.refreshToken);
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
      localStorage.setItem('arya_refresh', data.refreshToken);
    }
    return data;
  }

  logout() {
    this.setToken(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('arya_refresh');
      localStorage.removeItem('arya_admin');
    }
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
      localStorage.setItem('arya_refresh', data.refreshToken);
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

  async getUploadUrl(applicantId: string, fileName: string, mimeType: string) {
    return this.request<any>('/documents/upload-url', {
      method: 'POST',
      body: { applicantId, fileName, mimeType },
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

  async selfNominate(electionId: string, nomineeId: string, pitch?: string, answers?: { questionId: string; value: any }[]) {
    return this.request<any>(`/elections/${electionId}/self-nominate`, {
      method: 'POST',
      body: { nomineeId, pitch, answers }
    });
  }

  async getNominees(electionId: string) {
    return this.request<any[]>(`/elections/${electionId}/nominees`);
  }

  async submitElectionPitch(electionId: string, nomineeId: string, pitch: string) {
    return this.request<any>(`/elections/${electionId}/pitch`, {
      method: 'PUT',
      body: { nomineeId, pitch }
    });
  }

  async castVote(electionId: string, nomineeId: string, voterId?: string) {
    return this.request<any>(`/elections/${electionId}/vote`, {
      method: 'POST',
      body: { nomineeId, voterId }
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
}

export const api = new ApiClient();
