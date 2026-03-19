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

    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Request failed' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    if (response.status === 204) return {} as T;
    return response.json();
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

  logout() {
    this.setToken(null);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('arya_refresh');
      localStorage.removeItem('arya_admin');
    }
  }

  async getMe() {
    return this.request<any>('/admin/auth/me');
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

  async apply(data: any) {
    return this.request<any>('/applicants/apply', { method: 'POST', body: data });
  }

  async getApplicantStatus(accessToken: string) {
    return this.request<any>(`/applicants/status/${accessToken}`);
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

  async getBatchApplicants(id: string) {
    return this.request<any[]>(`/admin/batches/${id}/applicants`);
  }

  async transitionBatchStatus(id: string, status: string) {
    return this.request<any>(`/admin/batches/${id}/status`, {
      method: 'PUT',
      body: { status },
    });
  }

  async sendBatchInstructions(id: string, data: { title: string; content: string; additionalQuestionIds?: string[] }) {
    return this.request<any>(`/admin/batches/${id}/instructions`, {
      method: 'POST',
      body: data,
    });
  }

  async approveBatch(id: string) {
    return this.request<any>(`/admin/batches/${id}/approve`, { method: 'POST' });
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

  // Documents
  async getUploadUrl(applicantId: string, fileName: string, mimeType: string) {
    return this.request<any>('/documents/upload-url', {
      method: 'POST',
      body: { applicantId, fileName, mimeType },
    });
  }

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
}

export const api = new ApiClient();
