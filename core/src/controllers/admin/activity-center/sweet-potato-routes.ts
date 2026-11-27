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

/** 自动采集状态（面板进程内单例）：每 3 秒扫一次渲染进程，扫到新票据就入库。 */
const autoHarvest: { timer: any, accountId: string, rounds: number, saved: number, lastAt: number, error: string } = {
    timer: null, accountId: '', rounds: 0, saved: 0, lastAt: 0, error: '',
};

async function harvestOnce(ctx: any, accountId: string): Promise<number> {
    const result = await harvestTicketsFromMemory();
    let saved = 0;
    for (const item of result.tickets) {
        if (String(item?.activity) !== '2026111708') continue;
        const ok = await ctx.provider.saveSweetPotatoTicket(accountId, item.gid, item.ticket);
        if (ok?.saved) saved += 1;
    }
    return saved;
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
    // 探价：卖 1 个蜜薯换真实单价（无需票据，但会消耗库存与对方额度）
    mountGet('/api/activity-center/sweet-potato/prices', 'getSweetPotatoPrices');
    app.post('/api/activity-center/sweet-potato/probe', withAccount((accountId, req: Request) =>
        ctx.provider.probeSweetPotatoPrice(accountId, req.body?.gid, { force: req.body?.force === true })));
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
    // 自动采集：开着它，用户在游戏里点开谁家铺子就自动入库，不用手动点按钮。
    app.post('/api/activity-center/sweet-potato/harvest/auto', withAccount(async (accountId, req: Request) => {
        const on = req.body?.on === true;
        if (autoHarvest.timer) { clearInterval(autoHarvest.timer); autoHarvest.timer = null; }
        if (!on) return { running: false, rounds: autoHarvest.rounds, saved: autoHarvest.saved };
        autoHarvest.accountId = String(accountId);
        autoHarvest.rounds = 0;
        autoHarvest.saved = 0;
        autoHarvest.error = '';
        autoHarvest.timer = setInterval(() => {
            void (async () => {
                autoHarvest.rounds += 1;
                autoHarvest.lastAt = Date.now();
                try {
                    const saved = await harvestOnce(ctx, autoHarvest.accountId);
                    autoHarvest.saved += saved;
                }
                catch (error: any) {
                    autoHarvest.error = String(error?.message || error).slice(0, 200);
                }
                // 30 分钟兜底自动关，避免一直挂着扫内存
                if (autoHarvest.rounds > 600 && autoHarvest.timer) {
                    clearInterval(autoHarvest.timer);
                    autoHarvest.timer = null;
                }
            })();
        }, 3000);
        return { running: true };
    }));
    app.get('/api/activity-center/sweet-potato/harvest/auto', withAccount(async () => ({
        running: Boolean(autoHarvest.timer),
        rounds: autoHarvest.rounds,
        saved: autoHarvest.saved,
        lastAt: autoHarvest.lastAt,
        error: autoHarvest.error,
    })));
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