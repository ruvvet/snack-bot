import { config } from './config.ts';
import { isAdmin, type Invocation, type Reply } from './platform/http/types.ts';

/**
 * Whether someone may act as the buyer — confirm a purchase, or change the
 * budget they're spending.
 *
 * With no role configured, everyone can. Administrators always can: Discord
 * grants owners every permission but not every role, so a pure role check would
 * refuse an owner in their own server, and a role assigned to nobody would
 * refuse everyone.
 */
export function canBuy(i: Invocation): boolean {
  if (!config.buyerRoleId) return true;
  return i.roles.includes(config.buyerRoleId) || isAdmin(i.permissions);
}

export function buyerOnly(action: string): Reply {
  return {
    kind: 'ephemeral',
    text: `Only <@&${config.buyerRoleId}> can ${action}. Ask someone with that role.`,
  };
}
