export {};
/**
 * 以薯换福（组 2026111707 / 主活动 2026111708 / 副活动 2026111709）。
 *
 * 协议：ActivityService.Operate 的 f2 = cmd，参数与回包挂在 190+cmd 槽位。
 *   91 领每日红薯种子 → 191   92 查铺子行情 → 192   93 卖蜜薯 → 193
 *   95 收购记录 → 195         96 兑换下单 → 196     97 兑换目录 → 197
 *   98 分享本人铺子 → 198     99 领取收购提成 → 199
 *
 * 取证：本项目 2026-11-25/26 抓包验证 92/93/96/97/98 的请求体与回包；
 *      91/95/99 与 can_sell/quota 语义参考 muyuewang/qq-farm-bot-404 的交叉记录。
 */
const { sendMsgAsync, getUserState } = require('../utils/network');
const { types } = require('../utils/proto');
const { getBag } = require('./warehouse');
const { getItemById, getItemImageById } = require('../config/gameConfig');

const SERVICE = 'gamepb.activitypb.ActivityService';
const SHARE_SERVICE = 'gamepb.sharepb.ShareService';

const GROUP_ID = '2026111707';
const ACTIVITY_ID = '2026111708';

const ITEM_SWEET_POTATO = '1032';
const ITEM_LUCK_COIN = '1033';
const ITEM_RED_POTATO_SEED = '20307';

const CMD_CLAIM_SEED = 91;
const CMD_SHOP_QUERY = 92;
const CMD_SELL = 93;
const CMD_RECORDS = 95;
const CMD_EXCHANGE = 96;
const CMD_CATALOG = 97;
const CMD_SHARE = 98;
const CMD_CLAIM_COMMISSION = 99;

/** cmd → 请求里的参数槽位字段名 */
const CMD_PARAM_FIELD: Record<number, string> = {
  [CMD_CLAIM_SEED]: 'params_191',
  [CMD_SHOP_QUERY]: 'params_192',
  [CMD_SELL]: 'params_193',
  [CMD_RECORDS]: 'params_195',
  [CMD_EXCHANGE]: 'params_196',
  [CMD_CATALOG]: 'params_197',
  [CMD_SHARE]: 'params_198',
  [CMD_CLAIM_COMMISSION]: 'params_199',
};

/**
 * 兑换目录序号 → 官方道具。协议只下发序号与价格，序号到道具的映射来自客户端静态配置。
 * item_id 与价格取自 muyuewang/qq-farm-bot-404 的交叉核对结果；名称与图标优先用本地
 * gameConfig 解析，本地配置未收录（新道具）时回落到模板名，并由前端用截图裁出的图标兜底。
 */
const CATALOG_TEMPLATE: Record<string, { itemId: string; name: string; price: number }> = {
  '1': { itemId: '204013', name: '七彩花弦', price: 1000000 },
  '2': { itemId: '101627', name: '福气金豆礼包', price: 60000 },
  '3': { itemId: '40522', name: '金币果', price: 40000 },
  '4': { itemId: '40523', name: '经验蘑菇', price: 40000 },
  '5': { itemId: '80011', name: '有机化肥(1小时)', price: 8500 },
  '6': { itemId: '101620', name: '南瓜种子礼包', price: 28000 },
  '7': { itemId: '101621', name: '荷风种子礼包', price: 28000 },
  '8': { itemId: '101622', name: '千星种子礼包', price: 28000 },
  '9': { itemId: '101623', name: '萌宠种子礼包', price: 35000 },
  '10': { itemId: '80001', name: '化肥(1小时)', price: 7000 },
};

/** 把服务端目录项补齐为可展示结构；价格与模板不符时打标记，不静默改价。 */
function describeCatalogItem(index: string, serverPrice: number): any {
  const template = CATALOG_TEMPLATE[index];
  const numericId = template ? Number(template.itemId) : 0;
  const item = numericId ? getItemById(numericId) : undefined;
  const image = numericId ? getItemImageById(numericId) : '';
  return {
    itemId: template?.itemId || '',
    name: (item && item.name) || template?.name || `商品${index}`,
    image: image || '',
    templatePrice: template?.price ?? 0,
    priceMismatch: Boolean(template) && template.price !== serverPrice,
  };
}

const ACTIVITY_BEGIN_SEC = 1795572000;
const ACTIVITY_END_SEC = 1796831999;

const PRICE_TIERS: string[] = ['super', 'high', 'any'];

interface SweetPotatoSettings {
  autoSell: boolean;
  priceTier: 'super' | 'high' | 'any';
  keepCount: number;
  checkIntervalMinutes: number;
  autoExchange: boolean;
  sellToBestFriend: boolean;
  sellAfterTime: string;
  scanFriendLimit: number;
  scanIntervalMinutes: number;
}

const DEFAULT_SETTINGS: SweetPotatoSettings = {
  autoSell: false,
  priceTier: 'super',
  keepCount: 0,
  checkIntervalMinutes: 10,
  autoExchange: false,
  sellToBestFriend: false,
  sellAfterTime: '',
  scanFriendLimit: 20,
  scanIntervalMinutes: 120,
};

/**
 * 2026-11-28 客户端 1.17.1.13 起，服务端开始拒绝查询**他人**铺子行情：
 * Operate 92 传好友 gid 一律返回 1034184（活动操作失败）。
 * 自己铺子（92 传本人 gid）、出售 93、兑换 96/97、收购记录 95、领提成 99 均正常。
 * 因此好友比价改为"受限模式"：识别到该错误码就短缓存一段时间，不再逐家试探。
 */
const FRIEND_QUERY_BLOCKED_CODE = 1034184;
const FRIEND_BLOCKED_TTL_MS = 10 * 60 * 1000;
let friendQueryBlockedUntil = 0;

function isFriendQueryBlocked(error: any): boolean {
  return Number(error?.code) === FRIEND_QUERY_BLOCKED_CODE;
}

function friendQueryRestricted(): boolean {
  return Date.now() < friendQueryBlockedUntil;
}

function markFriendQueryBlocked(): void {
  friendQueryBlockedUntil = Date.now() + FRIEND_BLOCKED_TTL_MS;
}

function businessError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function toNum(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toId(value: unknown): string {
  return String(value ?? '').trim();
}

function ownGid(): string {
  return toId((getUserState() || {}).gid);
}

/**
 * 活动 RPC 串行化 + 最小间隔。
 * 教训（2026-11-26 帧级抓包）：页面首次加载时 Bag 与 GetGroup 同毫秒并发发出，
 * 网关从此不再回任何包（含心跳），表现为"登录后静默掉线"。
 * 活动侧所有请求一律排队串行，默认间隔 250ms。
 */
let srpcChain: Promise<unknown> = Promise.resolve();
let srpcLastAt = 0;
const SRPC_MIN_INTERVAL_MS = 250;

function pacedRpc<T>(task: () => Promise<T>): Promise<T> {
  const run: Promise<T> = srpcChain.then(async () => {
    const wait = SRPC_MIN_INTERVAL_MS - (Date.now() - srpcLastAt);
    if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
    srpcLastAt = Date.now();
    return task();
  }) as Promise<T>;
  srpcChain = run.catch(() => undefined);
  return run;
}

/** 背包余额短缓存：页面刷新不必每次都打 Bag。 */
const BAG_CACHE_TTL_MS = 30 * 1000;
let bagCacheAt = 0;
let bagCacheValue: any = null;

async function getBagCached(force = false): Promise<any> {
  if (!force && bagCacheValue && Date.now() - bagCacheAt < BAG_CACHE_TTL_MS) return bagCacheValue;
  return pacedRpc(async () => {
    const bag = await getBag();
    bagCacheValue = bag;
    bagCacheAt = Date.now();
    return bag;
  });
}

function buildOperateBody(cmd: number, params?: Record<string, unknown>): Buffer {
  const request: Record<string, unknown> = { activity_id: ACTIVITY_ID, cmd };
  const field = CMD_PARAM_FIELD[cmd];
  if (field) request[field] = params || {};
  return Buffer.from(types.YshfOperateRequest.encode(types.YshfOperateRequest.create(request)).finish());
}

async function operate(cmd: number, params?: Record<string, unknown>, timeoutMs = 15000): Promise<any> {
  const body = buildOperateBody(cmd, params);
  const { body: replyBody } = await pacedRpc<any>(() => sendMsgAsync(SERVICE, 'Operate', body, {
    requestClass: 'background',
    timeoutMs,
    expectReply: true,
  }));
  const reply = types.YshfOperateReply.decode(replyBody);
  if (String(reply.activity_id) !== ACTIVITY_ID) throw businessError('YSHF_ACTIVITY_MISMATCH', '活动回包 id 不匹配');
  if (toNum(reply.cmd) !== cmd) throw businessError('YSHF_CMD_MISMATCH', '活动回包命令字不匹配');
  return reply;
}

function bagItemCount(bagReply: any, itemId: string): number {
  const items = Array.isArray(bagReply?.item_bag?.items) ? bagReply.item_bag.items : [];
  let total = 0;
  for (const item of items) {
    if (toId(item?.id) === itemId) total += toNum(item?.count);
  }
  return total;
}

function activityWindowActive(nowSec = Math.floor(Date.now() / 1000)): boolean {
  return nowSec >= ACTIVITY_BEGIN_SEC && nowSec <= ACTIVITY_END_SEC;
}

/** 活动窗口（服务端时间为 UTC+8 秒级）。前端据此置灰入口与开关。 */
function getSweetPotatoWindow(nowSec = Math.floor(Date.now() / 1000)): any {
  return {
    beginSec: ACTIVITY_BEGIN_SEC,
    endSec: ACTIVITY_END_SEC,
    active: activityWindowActive(nowSec),
    expired: nowSec > ACTIVITY_END_SEC,
    notStarted: nowSec < ACTIVITY_BEGIN_SEC,
  };
}

/** cmd 92 行情归一化：成交价恒为 base + bonus。 */
function normalizeShop(reply: any, fallbackGid = ''): any {
  const quote = reply?.quote || {};
  const brief = quote.shop || {};
  const basePrice = toNum(quote.base_price);
  const bonusPrice = toNum(quote.bonus_price);
  return {
    gid: toId(brief.gid) || toId(fallbackGid),
    name: String(brief.name || ''),
    avatarUrl: String(brief.avatar || ''),
    level: toNum(brief.level),
    basePrice,
    bonusPrice,
    price: basePrice + bonusPrice,
    quota: toNum(quote.quota),
    // undefined = 服务端没下发，不要当成 false
    canSell: reply && Object.prototype.hasOwnProperty.call(reply, 'can_sell') ? Boolean(reply.can_sell) : undefined,
  };
}

/** 生成 92 查询票据：活动 id + 目标铺子 gid + 一次性 UUID。 */
function buildShopTicket(gid: string, token: string): any {
  return { activity_id: ACTIVITY_ID, shop_gid: gid, nonce: token };
}

/** 从分享链接/纯文本里抽出 8-4-4-4-12 形态的票据。 */
function extractShopToken(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const match = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(raw);
  return match ? match[0].toLowerCase() : '';
}

async function fetchShopQuote(gid: string, token = ''): Promise<any> {
  const isSelf = gid === ownGid();
  // 查他人铺子必须带服务端签发的票据（1.17.1.13 起），自己铺子不需要。
  // 票据只随好友的分享卡片下发，拿不到就查不了——所以要调用方显式传进来。
  const params: Record<string, unknown> = isSelf
    ? { shop_gid: gid }
    : { shop_gid: gid, ticket: buildShopTicket(gid, token) };
  const reply = await operate(CMD_SHOP_QUERY, params);
  return normalizeShop(reply.shop_192, gid);
}

/** 查询某个铺子的今日行情（自己或好友）。 */
async function getSweetPotatoShop(gidInput?: unknown, tokenInput?: unknown): Promise<any> {
  const gid = toId(gidInput) || ownGid();
  if (!/^\d+$/.test(gid)) throw businessError('INVALID_SWEET_POTATO_GID', '玩家 GID 必须是正十进制整数');
  const token = extractShopToken(tokenInput);
  if (gid !== ownGid() && !token) {
    throw businessError('SWEET_POTATO_TICKET_REQUIRED', '查看好友铺子需要对方分享卡片里的票据');
  }
  const shop = await fetchShopQuote(gid, token);
  if (!shop.price && !shop.quota) throw businessError('SWEET_POTATO_SHOP_UNAVAILABLE', '暂时无法读取红薯铺子行情，请稍后重试');
  return { ...shop, isSelf: gid === ownGid() };
}

/** 活动状态（GetGroup → 主活动 130 槽）。 */
async function fetchActivityState(): Promise<any> {
  const body = Buffer.from(types.GetGroupRequest.encode(types.GetGroupRequest.create({ group_id: GROUP_ID })).finish());
  const { body: replyBody } = await pacedRpc<any>(() => sendMsgAsync(SERVICE, 'GetGroup', body, {
    requestClass: 'background',
    timeoutMs: 15000,
    expectReply: true,
  }));
  const reply = types.GetGroupReply.decode(replyBody);
  const children = Array.isArray(reply?.group?.children) ? reply.group.children : [];
  const main = children.find((child: any) => toId(child?.activity?.activity_id) === ACTIVITY_ID) || null;
  const state = main?.yishuhuanfu || {};
  return {
    activityId: ACTIVITY_ID,
    groupId: GROUP_ID,
    claims: {
      seedClaimed: Boolean(state.claims?.seed_claimed),
      shareClaimed: Boolean(state.claims?.share_claimed),
    },
    luckCoin: toNum(state.luck_coin),
    basePrice: toNum(state.base_price),
    bonusPrice: toNum(state.bonus_price),
    capacity: toNum(state.capacity),
    pendingCommission: toNum(state.pending_commission),
    shareTimestamp: toNum(state.share?.timestamp),
  };
}

/** 活动总览：状态 + 本人铺子 + 背包存量。 */
async function getSweetPotatoState(): Promise<any> {
  const gid = ownGid();
  // 顺序执行：活动状态 → 铺子行情 → 背包（各步之间由 pacedRpc 保证间隔）
  // 注意：fetchActivityState 内部已经走 pacedRpc，这里不能再包一层，
   // 否则外层持有队列等内层、内层等队列释放 → 自死锁（实测：一帧都不发）。
  const activity = await fetchActivityState();
  const shop = await getSweetPotatoShop(gid);
  const bag = await getBagCached();
  const sweetPotato = bagItemCount(bag, ITEM_SWEET_POTATO);
  const luckCoin = bagItemCount(bag, ITEM_LUCK_COIN);
  return {
    activityId: ACTIVITY_ID,
    groupId: GROUP_ID,
    gid,
    activity,
    shop,
    sweetPotato,
    luckCoin: activity.luckCoin || luckCoin,
    seedCount: bagItemCount(bag, ITEM_RED_POTATO_SEED),
    sweetPotatoItemId: ITEM_SWEET_POTATO,
    luckCoinItemId: ITEM_LUCK_COIN,
    window: getSweetPotatoWindow(),
    settings: readSweetPotatoSettings(),
  };
}

/** cmd 91：领每日红薯种子。 */
async function claimSweetPotatoSeeds(): Promise<any> {
  const reply = await operate(CMD_CLAIM_SEED);
  const grant = reply.grant_191?.grant;
  return {
    itemId: toId(grant?.item_id),
    count: toNum(grant?.count),
  };
}

/** cmd 93：出售蜜薯。 */
let sellChain: Promise<unknown> = Promise.resolve();

function serializeSell<T>(task: () => Promise<T>): Promise<T> {
  const run = sellChain.then(task, task);
  sellChain = run.catch(() => undefined);
  return run;
}

async function sellSweetPotato(input: any = {}): Promise<any> {
  const gid = toId(input?.gid) || ownGid();
  if (!/^\d+$/.test(gid)) throw businessError('INVALID_SWEET_POTATO_GID', '玩家 GID 必须是正十进制整数');
  const count = Number(input?.count);
  if (!Number.isInteger(count) || count <= 0) throw businessError('INVALID_SWEET_POTATO_COUNT', '出售数量必须是正整数');

  return serializeSell(async () => {
    const reply = await operate(CMD_SELL, { shop_gid: gid, count });
    const result = reply.sell_193;
    if (!result) throw businessError('SWEET_POTATO_SELL_FAILED', '出售没有返回成交明细，请稍后重试');
    const soldCount = toNum(result.count);
    if (soldCount !== count) {
      // 部分成交不当作失败：按服务端回执记账，剩余留给下一轮
      return {
        gid,
        count: soldCount,
        unitPrice: toNum(result.price),
        totalGain: toNum(result.total),
        quota: toNum(result.quota),
        balance: toNum(result.balance),
        partial: true,
      };
    }
    return {
      gid,
      count: soldCount,
      unitPrice: toNum(result.price),
      totalGain: toNum(result.total),
      quota: toNum(result.quota),
      balance: toNum(result.balance),
      partial: false,
    };
  });
}

/** cmd 97：兑换目录。 */
async function getSweetPotatoExchangeShop(): Promise<any> {
  const reply = await operate(CMD_CATALOG);
  const catalog = reply.catalog_197;
  const goods = Array.isArray(catalog?.goods) ? catalog.goods : [];
  const items = goods.map((item: any) => {
    const index = toId(item?.index);
    const limit = toNum(item?.limit);
    const bought = toNum(item?.field_5);
    const price = toNum(item?.price);
    return {
      index,
      goodsId: index,
      ...describeCatalogItem(index, price),
      price,
      status: toNum(item?.status),
      limitTotal: limit,
      bought,
      remaining: Math.max(0, limit - bought),
    };
  });
  return { balance: toNum(catalog?.balance), items };
}

/** cmd 96：兑换下单（index 为目录序号）。 */
let exchangeChain: Promise<unknown> = Promise.resolve();

function serializeExchange<T>(task: () => Promise<T>): Promise<T> {
  const run = exchangeChain.then(task, task);
  exchangeChain = run.catch(() => undefined);
  return run;
}

async function exchangeSweetPotatoGoods(input: any = {}): Promise<any> {
  const index = toId(input?.index ?? input?.goodsId);
  if (!/^\d+$/.test(index)) throw businessError('INVALID_SWEET_POTATO_GOODS', '商品编号无效');
  const count = Number(input?.count);
  if (!Number.isInteger(count) || count <= 0) throw businessError('INVALID_SWEET_POTATO_COUNT', '兑换数量必须是正整数');

  return serializeExchange(async () => {
    const catalog = await getSweetPotatoExchangeShop();
    const target = catalog.items.find((item: any) => item.index === index);
    if (!target) throw businessError('SWEET_POTATO_GOODS_NOT_FOUND', '该商品不在兑换目录中');
    if (target.remaining < count) throw businessError('SWEET_POTATO_GOODS_LIMIT', `该商品剩余限购 ${target.remaining} 件`);
    const cost = target.price * count;
    if (catalog.balance < cost) throw businessError('INSUFFICIENT_FORTUNE_COIN', '福气币不足，无法兑换');

    const reply = await operate(CMD_EXCHANGE, { index, count });
    const result = reply.exchange_196;
    const after = await getSweetPotatoExchangeShop();
    return {
      index,
      name: target.name,
      count,
      cost: toNum(result?.price) * count || cost,
      itemId: toId(result?.grant?.item_id),
      itemCount: toNum(result?.grant?.count),
      balance: toNum(result?.balance) || after.balance,
      items: after.items,
    };
  });
}

/** cmd 95：收购记录（好友把蜜薯卖进你的铺子）。 */
async function getSweetPotatoRecords(): Promise<any> {
  const reply = await operate(CMD_RECORDS);
  const records = Array.isArray(reply.records_195?.records) ? reply.records_195.records : [];
  return records.map((record: any) => ({
    timestamp: toNum(record?.timestamp),
    gid: toId(record?.gid),
    name: String(record?.name || ''),
    avatarUrl: String(record?.avatar || ''),
    level: toNum(record?.level),
    count: toNum(record?.count),
    total: toNum(record?.total),
    commission: toNum(record?.commission),
  }));
}

/** cmd 99：领取收购提成。 */
async function claimSweetPotatoCommission(): Promise<any> {
  const reply = await operate(CMD_CLAIM_COMMISSION);
  const result = reply.commission_199;
  return {
    amount: toNum(result?.amount),
    balance: toNum(result?.balance),
  };
}

/**
 * cmd 98 + ShareService 上报：触发每日分享暴击。
 * 抓包确认：上报成功后 price_part_b 立即从 0 变为加成值（本项目实测 88 → 154）。
 */
async function triggerShareCrit(): Promise<any> {
  const before = await getSweetPotatoShop();
  let shareReply: any = null;
  try {
    const reply = await operate(CMD_SHARE);
    shareReply = reply.share_198 || null;
  }
  catch {
    // cmd 98 失败仍尝试 ShareService 上报：两条通道任一成功即可触发暴击
  }
  try {
    const checkBody = Buffer.from(types.CheckCanShareRequest.encode(types.CheckCanShareRequest.create({})).finish());
    const { body: checkReply } = await sendMsgAsync(SHARE_SERVICE, 'CheckCanShare', checkBody, {
      requestClass: 'background', timeoutMs: 15000, expectReply: true,
    });
    const check = types.CheckCanShareReply.decode(checkReply);
    if (check.can_share) {
      const shareBody = Buffer.from(types.ReportShareRequest.encode(types.ReportShareRequest.create({ field_1: 28, field_4: 2017 })).finish());
      await sendMsgAsync(SHARE_SERVICE, 'ReportShare', shareBody, {
        requestClass: 'background', timeoutMs: 15000, expectReply: true,
      });
    }
  }
  catch {
    // 上报通道失败不阻塞，最终以价格是否变化为准
  }
  const after = await getSweetPotatoShop();
  return {
    beforePrice: before.price,
    afterPrice: after.price,
    bonusPrice: after.bonusPrice,
    gained: after.price - before.price,
    shareKey: toId(shareReply?.shop?.share_key),
    seedGrant: shareReply?.grant ? { itemId: toId(shareReply.grant.item_id), count: toNum(shareReply.grant.count) } : null,
  };
}

/**
 * 好友铺子比价：按当日价降序，最多扫 scanFriendLimit 位，结果缓存 scanIntervalMinutes 分钟。
 */
let friendRankAt = 0;
let friendRankCache: any[] = [];

async function findBestFriendShop(sellable: number, options: { force?: boolean } = {}): Promise<any | null> {
  // 官方限制期内不再扫好友，自动出售退回"只卖自己铺子"。
  if (friendQueryRestricted()) return null;
  const settings = readSweetPotatoSettings();
  const ttl = Math.max(5, settings.scanIntervalMinutes) * 60000;
  if (!options.force && Date.now() - friendRankAt < ttl && friendRankCache.length) {
    return friendRankCache.find((shop: any) => shop.quota >= sellable) || null;
  }

  const { getFriendsList } = require('./friend');
  let friends: any[] = [];
  try {
    friends = await getFriendsList(false, 'low');
  }
  catch {
    return null;
  }
  const own = ownGid();
  const candidates = (Array.isArray(friends) ? friends : [])
    .map((friend: any) => ({ gid: toId(friend?.gid ?? friend?.uin) }))
    .filter((friend: any) => /^\d+$/.test(friend.gid) && friend.gid !== own)
    .slice(0, Math.max(1, settings.scanFriendLimit));

  const ranking: any[] = [];
  for (const candidate of candidates) {
    try {
      const shop = await fetchShopQuote(candidate.gid);
      if (shop.canSell === false) continue;
      ranking.push(shop);
    }
    catch (error: any) {
      if (isFriendQueryBlocked(error)) {
        markFriendQueryBlocked();
        break;
      }
      // 其他错误（网络抖动等）跳过，不影响整轮
    }
  }
  ranking.sort((a: any, b: any) => b.price - a.price);
  friendRankAt = Date.now();
  friendRankCache = ranking;
  return ranking.find((shop: any) => shop.quota >= sellable) || null;
}

/**
 * 设置持久化走独立 JSON（core/data/sweet-potato-settings.json）。
 *
 * 为什么不用 setAutomation：automation 表按布尔语义设计，写数字/字符串进去
 * 会被通用分支强制成布尔（keepCount:5 → true，读回 Number(true)=1），
 * 实测落库再读回就丢了。活动专有配置独立存一份，读写都只经过本文件。
 */
const SETTINGS_FILE_NAME = 'sweet-potato-settings.json';
let settingsCache: Record<string, any> | null = null;

function settingsFilePath(): string {
  const fs = require('node:fs');
  const path = require('node:path');
  const { getRuntimePaths } = require('../config/runtime-paths');
  const dir = getRuntimePaths().dataDir;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, SETTINGS_FILE_NAME);
}

function loadSettingsMap(): Record<string, any> {
  if (settingsCache) return settingsCache;
  try {
    const fs = require('node:fs');
    const file = settingsFilePath();
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    settingsCache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    settingsCache = {};
  }
  return settingsCache as Record<string, any>;
}

function persistSettingsMap(): void {
  const fs = require('node:fs');
  const file = settingsFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settingsCache || {}, null, 2));
  fs.renameSync(tmp, file);
}

function settingsAccountKey(accountId?: unknown): string {
  return String(accountId ?? 'default');
}

/**
 * 好友铺子比价排行：自动从 QQ 好友列表抓 GID，逐个读当日行情，按价降序返回。
 * 结果与自动出售共用同一份缓存（scanIntervalMinutes，默认 120 分钟），
 * 界面刷新带 force 才重新扫，避免每开一次页面就把好友铺子全点一遍。
 */
async function getFriendShopRanking(options: { force?: boolean; limit?: number } = {}): Promise<any> {
  const settings = readSweetPotatoSettings();
  const own = await getSweetPotatoShop();
  const maxFriends = Math.min(60, Math.max(1, Math.floor(Number(options.limit) || settings.scanFriendLimit)));
  const ttl = Math.max(5, settings.scanIntervalMinutes) * 60000;
  const cached = !options.force && friendRankCache.length > 0 && Date.now() - friendRankAt < ttl;

  // 限制期内直接返回受限态，不打任何好友请求。
  if (friendQueryRestricted() && !options.force) {
    return {
      own: { gid: own.gid, name: own.name, price: toNum(own.price), basePrice: own.basePrice, bonusPrice: own.bonusPrice, quota: own.quota },
      friends: [],
      fetchedAt: friendRankAt,
      cached: true,
      restricted: true,
      restrictedCode: FRIEND_QUERY_BLOCKED_CODE,
      scanned: 0,
      scanLimit: maxFriends,
      scanIntervalMinutes: settings.scanIntervalMinutes,
    };
  }

  let blocked = 0;
  if (!cached) {
    const { getFriendsList } = require('./friend/visit-strategy');
    let friends: any[] = [];
    try {
      friends = await getFriendsList(false, 'low');
    }
    catch (error: any) {
      throw businessError('SWEET_POTATO_FRIEND_LIST_FAILED', `读取好友列表失败: ${error?.message || error}`);
    }
    const ownGidValue = ownGid();
    const seen = new Set<string>();
    const candidates = (Array.isArray(friends) ? friends : [])
      .map((friend: any) => ({
        gid: toId(friend?.gid ?? friend?.uin),
        name: String(friend?.name || friend?.nickname || ''),
        level: toNum(friend?.level),
        avatarUrl: String(friend?.avatar_url || friend?.avatarUrl || ''),
      }))
      .filter((friend: any) => {
        if (!/^\d+$/.test(friend.gid)) return false;
        if (friend.gid === ownGidValue) return false;
        if (seen.has(friend.gid)) return false;
        seen.add(friend.gid);
        return true;
      })
      .slice(0, maxFriends);

    const rows: any[] = [];
    for (const candidate of candidates) {
      try {
        const shop = await fetchShopQuote(candidate.gid);
        rows.push({
          gid: candidate.gid,
          name: shop.name || candidate.name,
          level: shop.level || candidate.level,
          avatarUrl: shop.avatarUrl || candidate.avatarUrl,
          basePrice: shop.basePrice,
          bonusPrice: shop.bonusPrice,
          price: shop.price,
          quota: shop.quota,
          canSell: shop.canSell,
        });
      }
      catch (error: any) {
        if (isFriendQueryBlocked(error)) {
          blocked += 1;
          markFriendQueryBlocked();
          break;
        }
        // 单个好友读不到行情就跳过，不影响整轮排行
      }
    }
    rows.sort((left: any, right: any) => right.price - left.price);
    friendRankCache = rows;
    friendRankAt = Date.now();
  }

  const ownPrice = toNum(own.price);
  return {
    own: {
      gid: own.gid,
      name: own.name,
      price: ownPrice,
      basePrice: own.basePrice,
      bonusPrice: own.bonusPrice,
      quota: own.quota,
    },
    friends: friendRankCache.map((row: any) => ({
      ...row,
      delta: row.price - ownPrice,
      better: row.price > ownPrice,
    })),
    fetchedAt: friendRankAt,
    cached,
    restricted: blocked > 0 && friendRankCache.length === 0,
    restrictedCode: blocked > 0 ? FRIEND_QUERY_BLOCKED_CODE : 0,
    scanned: friendRankCache.length,
    scanLimit: maxFriends,
    scanIntervalMinutes: settings.scanIntervalMinutes,
  };
}

function readSweetPotatoSettings(accountId?: unknown): SweetPotatoSettings {
  const stored = loadSettingsMap()[settingsAccountKey(accountId)] || {};
  // 活动结束后开关一律按关闭处理：历史配置不允许把定时任务再拉起来。
  const window = getSweetPotatoWindow();
  const tier = PRICE_TIERS.includes(String(stored.priceTier)) ? String(stored.priceTier) : DEFAULT_SETTINGS.priceTier;
  const keepCount = Number(stored.keepCount);
  const interval = Number(stored.checkIntervalMinutes);
  const friendLimit = Number(stored.scanFriendLimit);
  const scanInterval = Number(stored.scanIntervalMinutes);
  const afterTime = String(stored.sellAfterTime ?? '').trim();
  return {
    autoSell: window.active && stored.autoSell === true,
    priceTier: tier as SweetPotatoSettings['priceTier'],
    keepCount: Number.isFinite(keepCount) && keepCount >= 0 ? Math.floor(keepCount) : DEFAULT_SETTINGS.keepCount,
    checkIntervalMinutes: Number.isFinite(interval) && interval >= 1 ? Math.min(180, Math.floor(interval)) : DEFAULT_SETTINGS.checkIntervalMinutes,
    autoExchange: window.active && stored.autoExchange === true,
    sellToBestFriend: stored.sellToBestFriend === true,
    sellAfterTime: /^(\d{1,2})[:：](\d{1,2})$/.test(afterTime) ? afterTime.replace('：', ':') : '',
    scanFriendLimit: Number.isFinite(friendLimit) && friendLimit >= 1 ? Math.min(60, Math.floor(friendLimit)) : DEFAULT_SETTINGS.scanFriendLimit,
    scanIntervalMinutes: Number.isFinite(scanInterval) && scanInterval >= 5 ? Math.min(720, Math.floor(scanInterval)) : DEFAULT_SETTINGS.scanIntervalMinutes,
  };
}

function saveSweetPotatoSettings(input: any = {}, accountId?: unknown): any {
  const patch: Record<string, unknown> = {};
  if (input.autoSell !== undefined) patch.autoSell = input.autoSell === true;
  if (input.autoExchange !== undefined) patch.autoExchange = input.autoExchange === true;
  if (input.sellToBestFriend !== undefined) patch.sellToBestFriend = input.sellToBestFriend === true;
  if (input.priceTier !== undefined) {
    const tier = String(input.priceTier);
    if (!PRICE_TIERS.includes(tier)) throw businessError('INVALID_SWEET_POTATO_TIER', '出售档位无效');
    patch.priceTier = tier;
  }
  if (input.keepCount !== undefined) {
    const keep = Number(input.keepCount);
    if (!Number.isFinite(keep) || keep < 0 || !Number.isInteger(keep)) throw businessError('INVALID_SWEET_POTATO_KEEP', '保留数量必须是非负整数');
    patch.keepCount = keep;
  }
  if (input.checkIntervalMinutes !== undefined) {
    const interval = Number(input.checkIntervalMinutes);
    if (!Number.isFinite(interval) || interval < 1 || interval > 180 || !Number.isInteger(interval)) throw businessError('INVALID_SWEET_POTATO_INTERVAL', '检查间隔必须是 1~180 的整数分钟');
    patch.checkIntervalMinutes = interval;
  }
  if (input.scanFriendLimit !== undefined) {
    const limit = Number(input.scanFriendLimit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 60 || !Number.isInteger(limit)) throw businessError('INVALID_SWEET_POTATO_FRIEND_LIMIT', '比价好友数必须是 1~60 的整数');
    patch.scanFriendLimit = limit;
  }
  if (input.scanIntervalMinutes !== undefined) {
    const minutes = Number(input.scanIntervalMinutes);
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 720 || !Number.isInteger(minutes)) throw businessError('INVALID_SWEET_POTATO_SCAN_INTERVAL', '比价间隔必须是 5~720 的整数分钟');
    patch.scanIntervalMinutes = minutes;
  }
  if (input.sellAfterTime !== undefined) {
    const raw = String(input.sellAfterTime ?? '').trim();
    if (raw && !/^(\d{1,2})[:：](\d{1,2})$/.test(raw)) throw businessError('INVALID_SWEET_POTATO_SELL_AFTER', '出售起始时间格式应为 HH:MM');
    patch.sellAfterTime = raw;
  }
  const key = settingsAccountKey(accountId);
  const map = loadSettingsMap();
  const current = map[key] || {};
  for (const [field, value] of Object.entries(patch)) current[field] = value;
  map[key] = current;
  persistSettingsMap();
  return readSweetPotatoSettings(accountId);
}

/** 出售时间闸门：服务器时间（UTC+8）当天分钟数。 */
function currentMinutesOfDay(nowMs = Date.now()): number {
  const shifted = new Date(nowMs + 8 * 3600 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function shouldSellNow(settings: SweetPotatoSettings, nowMs = Date.now()): boolean {
  const raw = settings.sellAfterTime;
  if (!raw) return true;
  const match = /^(\d{1,2})[:：](\d{1,2})$/.exec(raw);
  if (!match) return true;
  const gate = Math.min(23, Number(match[1])) * 60 + Math.min(59, Number(match[2]));
  return currentMinutesOfDay(nowMs) >= gate;
}

/**
 * 自动化一轮：领种子 → 分享暴击 → （到点）比价出售 → 领提成 → 兑换。
 * 全部动作都走 background 班次；写操作通过 automation-lock 由 worker 串行。
 */
async function runSweetPotatoAutomation(options: { manual?: boolean } = {}): Promise<any> {
  const settings = readSweetPotatoSettings();
  const manual = options.manual === true;
  if (!manual && !settings.autoSell && !settings.autoExchange) return { skipped: 'automation_disabled', settings };
  if (!activityWindowActive()) return { skipped: 'activity_closed', settings };

  const steps: any[] = [];
  const activity = await fetchActivityState();

  // 1) 领种子（幂等：服务端 claims 标记为真就跳过）
  if (!activity.claims.seedClaimed) {
    try {
      steps.push({ step: 'claim_seed', ...(await claimSweetPotatoSeeds()) });
    }
    catch (error: any) {
      steps.push({ step: 'claim_seed', error: error?.message || String(error) });
    }
  }
  else {
    steps.push({ step: 'claim_seed', skipped: 'already_claimed' });
  }

  // 2) 分享暴击（当日未分享且无加成时触发）
  let shop = await getSweetPotatoShop();
  if (toNum(shop.bonusPrice) === 0) {
    try {
      const crit = await triggerShareCrit();
      steps.push({ step: 'share_crit', ...crit });
      if (crit.gained > 0) shop = await getSweetPotatoShop();
    }
    catch (error: any) {
      steps.push({ step: 'share_crit', error: error?.message || String(error) });
    }
  }
  else {
    steps.push({ step: 'share_crit', skipped: 'already_active', bonusPrice: shop.bonusPrice });
  }

  // 3) 出售（受时间闸门与档位条件约束）
  // 手动跑一轮也遵守开关：自动出售没开就只做判断、不真卖，
  // 避免误点「立即执行一轮」把蜜薯全卖掉。
  if (settings.autoSell) {
    const bag = await getBag();
    const owned = bagItemCount(bag, ITEM_SWEET_POTATO);
    const sellable = Math.max(0, owned - settings.keepCount);
    const priceReady = settings.priceTier === 'any' || toNum(shop.bonusPrice) > 0;
    if (sellable <= 0) {
      steps.push({ step: 'sell_skipped', reason: 'no_inventory', owned });
    }
    else if (!priceReady) {
      steps.push({ step: 'sell_skipped', reason: 'waiting_boost', owned, sellable, bonusPrice: shop.bonusPrice });
    }
    else if (!shouldSellNow(settings)) {
      steps.push({ step: 'sell_skipped', reason: 'before_sell_time', sellAfterTime: settings.sellAfterTime });
    }
    else {
      let target = shop;
      let bestFriend: any = null;
      if (settings.sellToBestFriend) {
        bestFriend = await findBestFriendShop(sellable);
        if (bestFriend && bestFriend.price > shop.price && bestFriend.canSell !== false) target = bestFriend;
      }
      const result = await sellSweetPotato({ gid: target.gid, count: sellable });
      steps.push({
        step: 'sell',
        ...result,
        ownPrice: shop.price,
        targetPrice: target.price,
        toFriend: target.gid !== shop.gid,
        friendName: target.gid !== shop.gid ? (bestFriend?.name || target.name || '') : '',
      });
    }
  }
  else {
    const bagPreview = await getBagCached();
    steps.push({
      step: 'sell_skipped',
      reason: 'auto_sell_disabled',
      owned: bagItemCount(bagPreview, ITEM_SWEET_POTATO),
      price: shop.price,
      bonusPrice: shop.bonusPrice,
    });
  }

  // 4) 领收购提成
  const afterActivity = await fetchActivityState();
  if (toNum(afterActivity.pendingCommission) > 0) {
    try {
      steps.push({ step: 'claim_commission', ...(await claimSweetPotatoCommission()) });
    }
    catch (error: any) {
      steps.push({ step: 'claim_commission', error: error?.message || String(error) });
    }
  }

  // 5) 兑换（只在开关打开时执行，手动跑一轮也不会花福气币）
  if (settings.autoExchange) {
    const catalog = await getSweetPotatoExchangeShop();
    const bought: any[] = [];
    let balance = catalog.balance;
    for (const item of catalog.items) {
      if (bought.length >= 3) break;
      if (item.status && item.status !== 2 && item.status !== 0) continue;
      if (item.remaining <= 0) continue;
      if (balance < item.price) continue;
      try {
        const result = await exchangeSweetPotatoGoods({ index: item.index, count: 1 });
        bought.push({ index: result.index, name: result.name, cost: result.cost, itemId: result.itemId, itemCount: result.itemCount });
        balance = result.balance;
      }
      catch (error: any) {
        bought.push({ index: item.index, name: item.name, error: error?.message || String(error) });
        break;
      }
    }
    steps.push({ step: 'exchange', bought, balance });
  }
  else {
    steps.push({ step: 'exchange_skipped', reason: 'auto_exchange_disabled' });
  }

  return { skipped: null, at: Date.now(), settings, steps };
}

module.exports = {
  ACTIVITY_ID,
  GROUP_ID,
  ITEM_SWEET_POTATO,
  ITEM_LUCK_COIN,
  ITEM_RED_POTATO_SEED,
  CMD_CLAIM_SEED,
  CMD_SHOP_QUERY,
  CMD_SELL,
  CMD_RECORDS,
  CMD_EXCHANGE,
  CMD_CATALOG,
  CMD_SHARE,
  CMD_CLAIM_COMMISSION,
  bagItemCount,
  normalizeShop,
  buildOperateBody,
  activityWindowActive,
  shouldSellNow,
  readSweetPotatoSettings,
  saveSweetPotatoSettings,
  getSweetPotatoState,
  getSweetPotatoWindow,
  describeCatalogItem,
  extractShopToken,
  getSweetPotatoShop,
  claimSweetPotatoSeeds,
  sellSweetPotato,
  getSweetPotatoExchangeShop,
  exchangeSweetPotatoGoods,
  getSweetPotatoRecords,
  claimSweetPotatoCommission,
  triggerShareCrit,
  findBestFriendShop,
  getFriendShopRanking,
  runSweetPotatoAutomation,
};
