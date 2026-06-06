export interface AliyunDriveOpenApiClientOptions {
  openapiBase: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

export class AliyunDriveOpenApiClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: AliyunDriveOpenApiClientOptions) {
    this.base = options.openapiBase.replace(/\/+$/, '');
    this.token = options.accessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async post<T = unknown>(path: string, payload: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Aliyun OpenAPI failed: HTTP ${response.status} ${text.slice(0, 200)}`);
    }
    return await response.json() as T;
  }

  async getDriveInfo(): Promise<{ driveId: string; raw: unknown }> {
    const data = await this.post<Record<string, unknown>>('/adrive/v1.0/user/getDriveInfo', {});
    const driveId = String(data.default_drive_id ?? data.defaultDriveId ?? data.resource_drive_id ?? data.resourceDriveId ?? data.backup_drive_id ?? data.backupDriveId ?? '');
    if (!driveId) throw new Error('Aliyun Drive response did not include drive id');
    return { driveId, raw: data };
  }

  async createFileUpload(input: { driveId: string; parentFileId: string; name: string; size: number; partInfoList: Array<{ part_number: number }> }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/create', {
      drive_id: input.driveId,
      parent_file_id: input.parentFileId,
      name: input.name,
      type: 'file',
      check_name_mode: 'auto_rename',
      size: input.size,
      part_info_list: input.partInfoList,
    });
  }

  async getUploadUrl(input: { driveId: string; fileId: string; uploadId: string; partNumbers: number[] }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/getUploadUrl', {
      drive_id: input.driveId,
      file_id: input.fileId,
      upload_id: input.uploadId,
      part_info_list: input.partNumbers.map((part_number) => ({ part_number })),
    });
  }

  async completeUpload(input: { driveId: string; fileId: string; uploadId: string }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/complete', {
      drive_id: input.driveId,
      file_id: input.fileId,
      upload_id: input.uploadId,
    });
  }

  async getDownloadUrl(input: { driveId: string; fileId: string }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/getDownloadUrl', {
      drive_id: input.driveId,
      file_id: input.fileId,
    });
  }

  async deleteFile(input: { driveId: string; fileId: string }) {
    return await this.post<Record<string, unknown>>('/adrive/v1.0/openFile/delete', {
      drive_id: input.driveId,
      file_id: input.fileId,
    });
  }
}
