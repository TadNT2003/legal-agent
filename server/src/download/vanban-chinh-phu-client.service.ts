import {
  Injectable,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common';
import {
  REQUEST_DELAY_MS,
  REQUEST_USER_AGENT,
  SEARCH_PAGE_PATH,
  TRUSTED_FILE_HOST_SUFFIX,
  VANBANCHINHPHU_BASE_URL,
  VANBANCHINHPHU_HOST,
} from './constants';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Talks to vanban.chinhphu.vn only. Every call goes through this client so
 * "always download from vanban.chinhphu.vn" is enforced in one place rather
 * than scattered host checks.
 */
@Injectable()
export class VanBanChinhPhuClientService {
  private lastRequestAt = 0;

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    if (elapsed < REQUEST_DELAY_MS) {
      await sleep(REQUEST_DELAY_MS - elapsed);
    }
    this.lastRequestAt = Date.now();
  }

  assertTrustedPageUrl(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException(`Not a valid URL: ${url}`);
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== VANBANCHINHPHU_HOST
    ) {
      throw new BadRequestException(
        `Only https://${VANBANCHINHPHU_HOST} URLs are accepted as document sources, got: ${url}`,
      );
    }
    return parsed;
  }

  assertTrustedFileUrl(url: string): URL {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadGatewayException(
        `vanban.chinhphu.vn linked to an invalid file URL: ${url}`,
      );
    }
    if (
      parsed.protocol !== 'https:' ||
      !parsed.hostname.endsWith(TRUSTED_FILE_HOST_SUFFIX)
    ) {
      throw new BadGatewayException(
        `Refusing to download file from untrusted host: ${parsed.hostname}`,
      );
    }
    return parsed;
  }

  async fetchSearchPage(): Promise<string> {
    await this.throttle();
    const res = await fetch(`${VANBANCHINHPHU_BASE_URL}${SEARCH_PAGE_PATH}`, {
      headers: { 'User-Agent': REQUEST_USER_AGENT },
    });
    if (!res.ok) {
      throw new BadGatewayException(
        `Failed to load search page: HTTP ${res.status}`,
      );
    }
    return res.text();
  }

  async postSearch(fields: Record<string, string>): Promise<string> {
    await this.throttle();
    const res = await fetch(`${VANBANCHINHPHU_BASE_URL}${SEARCH_PAGE_PATH}`, {
      method: 'POST',
      headers: {
        'User-Agent': REQUEST_USER_AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields).toString(),
    });
    if (!res.ok) {
      throw new BadGatewayException(
        `Search request failed: HTTP ${res.status}`,
      );
    }
    return res.text();
  }

  async fetchDocumentPage(url: string): Promise<string> {
    this.assertTrustedPageUrl(url);
    await this.throttle();
    const res = await fetch(url, {
      headers: { 'User-Agent': REQUEST_USER_AGENT },
    });
    if (!res.ok) {
      throw new BadGatewayException(
        `Failed to load document page ${url}: HTTP ${res.status}`,
      );
    }
    return res.text();
  }

  async fetchFile(url: string): Promise<Response> {
    this.assertTrustedFileUrl(url);
    await this.throttle();
    const res = await fetch(url, {
      headers: { 'User-Agent': REQUEST_USER_AGENT },
    });
    if (!res.ok || !res.body) {
      throw new BadGatewayException(
        `Failed to download file ${url}: HTTP ${res.status}`,
      );
    }
    return res;
  }
}
