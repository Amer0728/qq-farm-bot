import { execFile } from 'node:child_process';
import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

/**
 * 好友铺子票据只能从分享卡片拿，卡片本身不落盘、也不经游戏回包下发。
 * 唯一的本机副本是"用户刚打开过好友铺子"时残留在 QQ 渲染进程内存里的明文请求，
 * 所以这里起一个只读扫描脚本把 (gid, ticket) 采出来入库。
 */
function harvestTicketsFromMemory(): Promise<{ found: number, tickets: Array<{ activity: string, gid: string, ticket: string }> }> {
    const { getResourcePath } = require('../../../config/runtime-paths');
    const script = getResourcePath('scripts', 'harvest-sweet-tickets.ps1');
    return new Promise((resolve, reject) => {
        execFile('pwsh',
            ['-NoProfile', '-NonInteractive', '-File', script],
            { timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
            (error, stdout) => {
                if (error) { reject(error); return; }
                try {
                    const text = String(stdout || '').trim();
                    const start = text.indexOf('{');
                    const parsed = JSON.parse(start >= 0 ? text.slice(start) : text);
                    resolve({
                        found: Number(parsed?.found) || 0,
                        tickets: Array.isArray(parsed?.tickets) ? parsed.tickets : [],
                    });
                }
                catch (cause) {
                    reject(cause);
                }
            });
    });
}

export function mountSweetPotatoRoutes({ app, ctx, withAccount, mountGet }: ActivityRouteContext): void {
    mountGet('/api/activity-center/sweet-potato', 'getSweetPotatoState');
    mountGet('/api/activity-center/sweet-potato/exchange', 'getSweetPotatoExchangeShop');
    app.post('/api/activity-center/sweet-potato/exchange', withAccount((accountId, req: Request) =>
        ctx.provider.exchangeSweetPotatoGoods(accountId, req.body?.goodsId, req.body?.count)));
    app.post('/api/activity-center/sweet-potato/share-crit', withAccount(accountId =>
        ctx.provider.triggerSweetPotatoShareCrit(accountId)));
    app.post('/api/activity-center/sweet-potato/run', withAccount(accountId =>
        ctx.provider.runSweetPotatoAutomation(accountId)));
    mountGet('/api/activity-center/sweet-potato/records', 'getSweetPotatoRecords');
    // 票据仓库：查他人铺子必须带票据（官方 1.17.1.13 起），这里负责导入与查看。
    mountGet('/api/activity-center/sweet-potato/tickets', 'getSweetPotatoTickets');
    app.post('/api/activity-center/sweet-potato/tickets', withAccount((accountId, req: Request) =>
        ctx.provider.saveSweetPotatoTicket(accountId, req.body?.gid, req.body?.token)));
    // 从 QQ 渲染进程内存里只读采集票据（需游戏端打开过好友铺子）
    app.post('/api/activity-center/sweet-potato/harvest', withAccount(async (accountId) => {
        const result = await harvestTicketsFromMemory();
        const saved: string[] = [];
        for (const item of result.tickets) {
            if (String(item?.activity) !== '2026111708') continue;
            const ok = await ctx.provider.saveSweetPotatoTicket(accountId, item.gid, item.ticket);
            if (ok?.saved) saved.push(String(item.gid));
        }
        return { found: result.found, saved: saved.length, gids: saved };
    }));
    // 好友铺子比价：自动从 QQ 好友列表取 GID；?force=1 才重新扫（默认走缓存）。
    app.get('/api/activity-center/sweet-potato/friends', withAccount((accountId, req: Request) =>
        ctx.provider.getSweetPotatoFriendRanking(accountId, {
            force: String(req.query?.force ?? '') === '1',
        })));
    app.post('/api/activity-center/sweet-potato/claim-seed', withAccount(accountId =>
        ctx.provider.claimSweetPotatoSeeds(accountId)));
    app.post('/api/activity-center/sweet-potato/claim-commission', withAccount(accountId =>
        ctx.provider.claimSweetPotatoCommission(accountId)));
    // token 来自好友分享卡片；官方 1.17.1.13 起查他人铺子必须带票据。
    app.post('/api/activity-center/sweet-potato/shop', withAccount((accountId, req: Request) =>
        ctx.provider.getSweetPotatoShop(accountId, req.body?.gid, req.body?.token)));
    app.post('/api/activity-center/sweet-potato/sell', withAccount((accountId, req: Request) =>
        ctx.provider.sellSweetPotato(accountId, req.body?.gid, req.body?.count)));
    app.post('/api/activity-center/sweet-potato/settings', withAccount((accountId, req: Request) =>
        ctx.provider.saveSweetPotatoSettings(accountId, req.body ?? {})));
}