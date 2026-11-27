import type { Request } from 'express';
import type { ActivityRouteContext } from './types';

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
