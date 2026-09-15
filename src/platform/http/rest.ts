const API = 'https://discord.com/api/v10';

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
}

export interface Component {
  type: number;
  components?: Component[];
  custom_id?: string;
  style?: number;
  label?: string;
  disabled?: boolean;
  placeholder?: string;
  options?: { label: string; value: string; description?: string }[];
}

export interface MessagePayload {
  content?: string;
  embeds?: Embed[];
  components?: Component[];
}

/**
 * The slice of Discord's REST API this app needs. Interaction responses go back
 * as the HTTP response body; these calls are for everything else — posting the
 * public card after an ephemeral pick, and the scheduled digest, neither of
 * which has an interaction to reply to.
 */
export function rest(token: string) {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      throw new Error(`Discord ${method} ${path} → ${res.status} ${await res.text()}`);
    }
    return res.status === 204 ? null : await res.json();
  }

  return {
    async createMessage(channelId: string, payload: MessagePayload): Promise<string> {
      const msg = (await call('POST', `/channels/${channelId}/messages`, payload)) as { id: string };
      return msg.id;
    },
    /** Replace a deferred interaction reply with the real one. */
    async editOriginalReply(appId: string, token: string, payload: MessagePayload): Promise<void> {
      await call('PATCH', `/webhooks/${appId}/${token}/messages/@original`, payload);
    },
    async editMessage(channelId: string, messageId: string, payload: MessagePayload): Promise<void> {
      await call('PATCH', `/channels/${channelId}/messages/${messageId}`, payload);
    },
  };
}

export type Rest = ReturnType<typeof rest>;
