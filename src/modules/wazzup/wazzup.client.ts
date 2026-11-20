import { BadGatewayException, GatewayTimeoutException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

export interface WazzupChat {
  chatType: "whatsapp";
  chatId: string;
  name?: string;
}

export interface WazzupIframeRequest {
  user: { id: string; name: string };
  scope: "global" | "card";
  filter?: WazzupChat[];
  activeChat?: { chatType: "whatsapp"; chatId: string; channelId?: string };
}

export interface WazzupChannel {
  channelId: string;
  transport: string;
  plainId: string;
  state: string;
}

export interface WazzupContact {
  id: string;
  responsibleUserId: string;
  name: string;
  contactData: Pick<WazzupChat, "chatType" | "chatId">[];
}

@Injectable()
export class WazzupClient {
  private readonly logger = new Logger(WazzupClient.name);

  constructor(private readonly config: ConfigService) {}

  async channels(): Promise<WazzupChannel[]> {
    const data = await this.request("GET", "channels");
    if (
      !Array.isArray(data) ||
      !data.every((item: unknown): item is WazzupChannel => this.isRecord(item) && ["channelId", "transport", "plainId", "state"].every(field => typeof item[field] === "string"))
    ) {
      throw this.invalidResponse();
    }
    return data.map(({ channelId, transport, plainId, state }: WazzupChannel) => ({ channelId, transport, plainId, state }));
  }

  async iframe(payload: WazzupIframeRequest, contacts: WazzupContact[] = [], revalidate?: () => Promise<void>): Promise<{ url: string }> {
    // One operation budget also bounds large contact batches. Each HTTP request
    // retains its shorter timeout; neither failed writes nor sessions are retried.
    const signal = AbortSignal.timeout(30_000);
    const channels = await this.channels();
    const channelId = this.config.get<string>("WAZZUP_CHANNEL_ID", "").trim();
    const available = channels.some(channel => ["whatsapp", "wapi"].includes(channel.transport) && channel.state === "active" && (!channelId || channel.channelId === channelId));
    if (!available) throw new ServiceUnavailableException({ code: "WAZZUP_CHANNEL_UNAVAILABLE", message: "No active configured WhatsApp channel is available" });
    await revalidate?.();
    // Upserts the authenticated CRM user. No external work happens on startup.
    await this.request("POST", "users", [payload.user], signal);
    for (let offset = 0; offset < contacts.length; offset += 100) {
      await this.request("POST", "contacts", contacts.slice(offset, offset + 100), signal);
    }
    await revalidate?.();
    const data = await this.request("POST", "iframe", payload, signal);
    if (!this.isRecord(data) || typeof data.url !== "string") throw this.invalidResponse();
    let url: URL;
    try {
      url = new URL(data.url);
    } catch {
      throw this.invalidResponse();
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".wazzup24.com") ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !url.searchParams.get("token")
    ) {
      throw this.invalidResponse();
    }
    return { url: data.url };
  }

  private async request(method: "GET" | "POST", path: "channels" | "users" | "contacts" | "iframe", data?: unknown, signal?: AbortSignal): Promise<unknown> {
    const enabled = this.config.get<string>("WAZZUP_ENABLED", "false").trim().toLowerCase() === "true";
    const apiKey = this.config.get<string>("WAZZUP_API_KEY", "").trim();
    if (!enabled || !apiKey) {
      throw new ServiceUnavailableException({ code: "WAZZUP_NOT_CONFIGURED", message: "Wazzup is not configured" });
    }

    try {
      const response = await axios.request<unknown>({
        method,
        url: `https://api.wazzup24.com/v3/${path}`,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        data,
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        signal,
      });
      if (this.isRecord(response.data) && response.data.error) throw this.invalidResponse();
      return response.data;
    } catch (error: unknown) {
      // Axios errors contain the API key, customer data, and sometimes iframe tokens.
      if (error instanceof BadGatewayException) throw error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      this.logger.warn(`Wazzup ${method} /${path} failed (status=${status ?? "unavailable"})`);
      if (axios.isAxiosError(error) && (["ECONNABORTED", "ETIMEDOUT"].includes(error.code ?? "") || (error.code === "ERR_CANCELED" && signal?.aborted))) {
        throw new GatewayTimeoutException({ code: "WAZZUP_TIMEOUT", message: "Wazzup request timed out" });
      }
      if (status === 429) {
        throw new ServiceUnavailableException({ code: "WAZZUP_RATE_LIMITED", message: "Wazzup rate limit reached; try again later" });
      }
      throw new BadGatewayException({
        code: status === 401 || status === 403 ? "WAZZUP_ACCESS_DENIED" : "WAZZUP_UPSTREAM_ERROR",
        message: status === 401 || status === 403 ? "Check the Wazzup API key and integration permissions" : "Wazzup request failed",
      });
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  private invalidResponse() {
    return new BadGatewayException({ code: "WAZZUP_INVALID_RESPONSE", message: "Wazzup returned an invalid response" });
  }
}
