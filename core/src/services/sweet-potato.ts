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
  /** 自动探价：拿不到票据时，卖 1 个蜜薯换真实价（会消耗库存）。默认关闭。 */
  autoProbe: boolean;
  /** 单轮最多探几家，默认 2。 */
  autoProbeMaxPerRound: number;
  /** 只有探到的价 ≥ 自己铺子价 × 该百分比时才卖，默认 110（即高 10%）。 */
  autoProbeMinRatio: number;
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
  autoProbe: false,
  autoProbeMaxPerRound: 2,
  autoProbeMinRatio: 110,
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

/**
 * 好友票据仓库：core/data/sweet-shop-tickets.json
 * { [gid]: { ticket, source, updatedAt } }
 *
 * 服务端从 1.17.1.13 起要求查他人铺子必须带票据，票据只随好友分享卡片下发。
 * 三条采集通道（QQ 卡片消息 / 进程内存只读扫描 / 本地存储解析）最终都写到这里，
 * 查询时优先取库里的票据，没有就跳过该好友，不做无效请求。
 */
const TICKET_FILE_NAME = 'sweet-shop-tickets.json';
let ticketCache: Record<string, any> | null = null;

function ticketFilePath(): string {
  const fs = require('node:fs');
  const path = require('node:path');
  const { getRuntimePaths } = require('../config/runtime-paths');
  const dir = getRuntimePaths().dataDir;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, TICKET_FILE_NAME);
}

function loadTicketStore(): Record<string, any> {
  if (ticketCache) return ticketCache;
  try {
    const fs = require('node:fs');
    const file = ticketFilePath();
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    ticketCache = raw && typeof raw === 'object' ? raw : {};
  } catch {
    ticketCache = {};
  }
  return ticketCache as Record<string, any>;
}

function persistTicketStore(): void {
  const fs = require('node:fs');
  const file = ticketFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ticketCache || {}, null, 2));
  fs.renameSync(tmp, file);
}

/** 写入/更新一枚票据。source 记录来源：card | memory | storage | manual。 */
function saveShopTicket(gidInput: unknown, tokenInput: unknown, source = 'manual'): boolean {
  const gid = toId(gidInput);
  const token = extractShopToken(tokenInput);
  if (!/^\d+$/.test(gid) || !token) return false;
  const store = loadTicketStore();
  store[gid] = { ticket: token, source: String(source || 'manual').slice(0, 16), updatedAt: Date.now() };
  persistTicketStore();
  return true;
}

function getShopTicket(gidInput: unknown): string {
  const gid = toId(gidInput);
  if (!/^\d+$/.test(gid)) return '';
  return extractShopToken(loadTicketStore()[gid]?.ticket);
}

/** 票据失效（服务端回 1034184）时丢弃，下次重新采集。 */
function dropShopTicket(gidInput: unknown): void {
  const gid = toId(gidInput);
  const store = loadTicketStore();
  if (store[gid]) { delete store[gid]; persistTicketStore(); }
}

/** 列出已采集的票据（票据本身打码，只给界面看状态）。 */
function listShopTickets(): any[] {
  const store = loadTicketStore();
  return Object.entries(store).map(([gid, value]: [string, any]) => ({
    gid,
    source: String(value?.source || ''),
    updatedAt: Number(value?.updatedAt) || 0,
    masked: `${String(value?.ticket || '').slice(0, 8)}…`,
  }));
}

/**
 * 探价用的价格缓存：core/data/sweet-shop-prices.json
 * { [gid]: { price, quota, day, at } }，按服务端日（UTC+8）失效。
 *
 * 背景：1.17.1.13 起查他人铺子必须带票据（只随好友卡片下发），拿不到票就看不到价。
 * 但出售接口（93）不看票据，回包直接带真实成交单价——
 * 所以「卖 1 个蜜薯」就是一次合法的价格探测，代价是 1 个蜜薯 + 对方 1 点接收额度。
 * 只允许手动触发，自动流程绝不主动消耗库存。
 */
const PRICE_FILE_NAME = 'sweet-shop-prices.json';
let priceCacheStore: Record<string, any> | null = null;

function serverDayKey(nowMs = Date.now()): string {
  return new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function priceFilePath(): string {
  const fs = require('node:fs');
  const path = require('node:path');
  const { getRuntimePaths } = require('../config/runtime-paths');
  const dir = getRuntimePaths().dataDir;
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, PRICE_FILE_NAME);
}

function loadPriceStore(): Record<string, any> {
  if (priceCacheStore) return priceCacheStore;
  try {
    const fs = require('node:fs');
    const file = priceFilePath();
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    priceCacheStore = raw && typeof raw === 'object' ? raw : {};
  } catch {
    priceCacheStore = {};
  }
  return priceCacheStore as Record<string, any>;
}

function persistPriceStore(): void {
  const fs = require('node:fs');
  const file = priceFilePath();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(priceCacheStore || {}, null, 2));
  fs.renameSync(tmp, file);
}

const PRICE_HISTORY_MAX = 30;

function saveShopPrice(gidInput: unknown, price: number, quota: number): void {
  const gid = toId(gidInput);
  if (!/^\d+$/.test(gid) || !(price > 0)) return;
  const store = loadPriceStore();
  const day = serverDayKey();
  const at = Date.now();
  const history: any[] = Array.isArray(store[gid]?.history) ? store[gid].history : [];
  if (!history.some((row: any) => row?.day === day)) history.push({ day, price: Math.round(price), at });
  store[gid] = {
    price: Math.round(price),
    quota: toNum(quota),
    day,
    at,
    history: history.slice(-PRICE_HISTORY_MAX),
  };
  persistPriceStore();
}

/** 某铺子的探价历史（最近在前）。 */
function getShopPriceHistory(gidInput: unknown): any[] {
  const gid = toId(gidInput);
  const history: any[] = Array.isArray(loadPriceStore()[gid]?.history) ? loadPriceStore()[gid].history : [];
  return [...history].reverse().map((row: any) => ({ day: String(row?.day || ''), price: toNum(row?.price), at: toNum(row?.at) }));
}

/**
 * 探价前预估：这次探会不会花蜜薯、今天是不是已经探过、历史上探到过多少、自己铺子多少。
 * 只读，不消耗任何资源。
 */
async function probePreview(gidInput: unknown): Promise<any> {
  const gid = toId(gidInput);
  if (!/^\d+$/.test(gid)) throw businessError('INVALID_SWEET_POTATO_GID', '玩家 GID 必须是正十进制整数');
  const bag = await getBagCached();
  const inventory = bagItemCount(bag, ITEM_SWEET_POTATO);
  const today = getShopPrice(gid);
  const history = getShopPriceHistory(gid);
  const own = await getSweetPotatoShop();
  return {
    gid,
    inventory,
    todayPrice: today ? today.price : 0,
    alreadyProbedToday: Boolean(today),
    willSpend: today ? 0 : 1,
    canProbe: !today && inventory >= 1 && gid !== ownGid(),
    history,
    own: { gid: own.gid, price: own.price },
    // 历史最高价用来判断值得不值得卖给他
    historyMax: history.reduce((max: number, row: any) => Math.max(max, toNum(row?.price)), 0),
  };
}

/** 取当天有效的探价结果。 */
function getShopPrice(gidInput: unknown): any | null {
  const gid = toId(gidInput);
  const row = loadPriceStore()[gid];
  if (!row || row.day !== serverDayKey()) return null;
  return { gid, price: toNum(row.price), quota: toNum(row.quota), at: toNum(row.at), source: 'probe' };
}

function listShopPrices(): any[] {
  const day = serverDayKey();
  return Object.entries(loadPriceStore())
    .filter(([, row]: [string, any]) => row?.day === day)
    .map(([gid, row]: [string, any]) => ({ gid, price: toNum(row?.price), quota: toNum(row?.quota), at: toNum(row?.at) }));
}

/** 生成 92 查询票据：活动 id + 目标铺子 gid + 一次性 UUID。 */
function buildShopTicket(gid: string, token: string): any {
  return { activity_id: ACTIVITY_ID, shop_gid: gid, nonce: token };
}

/**
 * 从分享链接/纯文本里抽票据。
 * 服务端签发的凭证有两种形态：
 *   - UUID：8-4-4-4-12（好友卡片里的）
 *   - 32 位十六进制（cmd 98 分享回包里的 shop.share_key）
 */
function extractShopToken(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const match = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}/i.exec(raw);
  return match ? match[0].toLowerCase() : '';
}

async function fetchShopQuote(gid: string, token = ''): Promise<any> {
  const isSelf = gid === ownGid();
  // 查他人铺子必须带服务端签发的票据（1.17.1.13 起），自己铺子不需要。
  // 优先级：显式传入 > 仓库里已采集的。
  const effective = isSelf ? '' : (extractShopToken(token) || getShopTicket(gid));
  const params: Record<string, unknown> = isSelf
    ? { shop_gid: gid }
    : { shop_gid: gid, ticket: buildShopTicket(gid, effective) };
  try {
    const reply = await operate(CMD_SHOP_QUERY, params);
    return normalizeShop(reply.shop_192, gid);
  }
  catch (error: any) {
    // 票据失效就丢弃，避免一直用坏票
    if (Number(error?.code) === FRIEND_QUERY_BLOCKED_CODE && effective) dropShopTicket(gid);
    throw error;
  }
}

/** 查询某个铺子的今日行情（自己或好友）。 */
async function getSweetPotatoShop(gidInput?: unknown, tokenInput?: unknown): Promise<any> {
  const gid = toId(gidInput) || ownGid();
  if (!/^\d+$/.test(gid)) throw businessError('INVALID_SWEET_POTATO_GID', '玩家 GID 必须是正十进制整数');
  // 显式传入优先，其次用仓库里已采集的票据。
  const token = extractShopToken(tokenInput) || getShopTicket(gid);
  if (gid !== ownGid() && !token) {
    throw businessError('SWEET_POTATO_TICKET_REQUIRED', '查看好友铺子需要对方分享卡片里的票据');
  }
  const shop = await fetchShopQuote(gid, token);
  if (!shop.price && !shop.quota) throw businessError('SWEET_POTATO_SHOP_UNAVAILABLE', '暂时无法读取红薯铺子行情，请稍后重试');
  // 查询成功说明票据有效，落库供后续比价复用。
  if (token && gid !== ownGid()) saveShopTicket(gid, token, 'manual');
  return { ...shop, isSelf: gid === ownGid() };
}

/**
 * 探价：卖 1 个蜜薯给目标铺子，从 93 回包读真实成交单价并缓存。
 * 会消耗 1 个蜜薯，并占用对方 1 点接收额度——只在手动触发时执行。
 */
async function probeFriendShopPrice(gidInput: unknown, options: { force?: boolean } = {}): Promise<any> {
  const gid = toId(gidInput);
  if (!/^\d+$/.test(gid)) throw businessError('INVALID_SWEET_POTATO_GID', '玩家 GID 必须是正十进制整数');
  if (gid === ownGid()) throw businessError('SWEET_POTATO_PROBE_SELF', '探价只用于好友铺子，自己铺子直接查行情即可');
  const cached = getShopPrice(gid);
  if (cached && !options.force) return { ...cached, spent: 0, cached: true };
  const bag = await getBagCached(true);
  const owned = bagItemCount(bag, ITEM_SWEET_POTATO);
  if (owned < 1) throw businessError('SWEET_POTATO_NO_INVENTORY', '背包里没有蜜薯，无法探价');
  const result = await sellSweetPotato({ gid, count: 1 });
  saveShopPrice(gid, result.unitPrice, result.quota);
  return {
    gid,
    price: result.unitPrice,
    spent: result.count,
    gain: result.totalGain,
    quota: result.quota,
    balance: result.balance,
    cached: false,
  };
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
    // 候选 = 好友列表 ∪ 票据仓库里的 gid。
    // 票据可能来自好友分享卡片，也可能是用户从群/私聊点开的非好友铺子，
    // 只要采到票就应当参与比价。
    const storeGids = Object.keys(loadTicketStore()).filter((gid: string) => /^\d+$/.test(gid) && gid !== ownGidValue);
    const friendRows = Array.isArray(friends) ? friends : [];
    const friendGidSet = new Set(friendRows.map((one: any) => toId(one?.gid ?? one?.uin)));
    const extraRows = storeGids
      .filter((gid: string) => !friendGidSet.has(gid))
      .map((gid: string) => ({ gid, name: '', level: 0, avatar_url: '' }));
    const candidates = [...friendRows, ...extraRows]
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
      .filter((friend: any) => Boolean(getShopTicket(friend.gid)) || Boolean(getShopPrice(friend.gid)))
      .slice(0, maxFriends);

    const rows: any[] = [];
    for (const candidate of candidates) {
      const probed = getShopPrice(candidate.gid);
      if (probed && !getShopTicket(candidate.gid)) {
        // 没票但有当天探价结果：直接用它，不再发请求（省额度也省时间）
        rows.push({
          gid: candidate.gid,
          name: candidate.name,
          level: candidate.level,
          avatarUrl: candidate.avatarUrl,
          basePrice: 0,
          bonusPrice: 0,
          price: probed.price,
          quota: probed.quota,
          canSell: undefined,
          priceSource: 'probe',
        });
        continue;
      }
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
          priceSource: 'ticket',
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

/**
 * 挑探价候选：只考虑
 *   - 有历史探价记录（说明是我们真的关心过的铺子）
 *   - 今天还没探过（价格缓存当天有效，避免重复花钱）
 *   - 没有票据（有票就不用花蜜薯了）
 * 按历史最高价降序，取前 budget 家。
 */
function listProbeCandidates(settings: SweetPotatoSettings, budget: number): Array<{ gid: string, historyMax: number }> {
  const store = loadPriceStore();
  const rows: Array<{ gid: string, historyMax: number }> = [];
  for (const [gid, row] of Object.entries(store)) {
    if (!/^\d+$/.test(gid)) continue;
    if (gid === ownGid()) continue;
    if (getShopTicket(gid)) continue;
    if (getShopPrice(gid)) continue;
    const history: any[] = Array.isArray((row as any)?.history) ? (row as any).history : [];
    const historyMax = history.reduce((max: number, item: any) => Math.max(max, toNum(item?.price)), 0);
    if (historyMax <= 0) continue;
    rows.push({ gid, historyMax });
  }
  rows.sort((left, right) => right.historyMax - left.historyMax);
  return rows.slice(0, Math.max(1, budget));
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
  const probeMax = Number(stored.autoProbeMaxPerRound);
  const probeRatio = Number(stored.autoProbeMinRatio);
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
    autoProbe: window.active && stored.autoProbe === true,
    autoProbeMaxPerRound: Number.isFinite(probeMax) && probeMax >= 1 ? Math.min(5, Math.floor(probeMax)) : DEFAULT_SETTINGS.autoProbeMaxPerRound,
    autoProbeMinRatio: Number.isFinite(probeRatio) && probeRatio >= 100 ? Math.min(500, Math.floor(probeRatio)) : DEFAULT_SETTINGS.autoProbeMinRatio,
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
  if (input.autoProbe !== undefined) patch.autoProbe = input.autoProbe === true;
  if (input.autoProbeMaxPerRound !== undefined) {
    const max = Number(input.autoProbeMaxPerRound);
    if (!Number.isFinite(max) || max < 1 || max > 5 || !Number.isInteger(max)) throw businessError('INVALID_SWEET_POTATO_PROBE_MAX', '每轮探价家数必须是 1~5 的整数');
    patch.autoProbeMaxPerRound = max;
  }
  if (input.autoProbeMinRatio !== undefined) {
    const ratio = Number(input.autoProbeMinRatio);
    if (!Number.isFinite(ratio) || ratio < 100 || ratio > 500 || !Number.isInteger(ratio)) throw businessError('INVALID_SWEET_POTATO_PROBE_RATIO', '探价溢价阈值必须是 100~500 的整数百分比');
    patch.autoProbeMinRatio = ratio;
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

  // 2.5) 自动探价：拿不到票据的好友里，挑历史价最高的几家各卖 1 个蜜薯换真实价。
  // 护栏：默认关闭；单轮上限可配；库存必须够「保留量 + 探价消耗」；探自己铺子永不触发。
  if (settings.autoProbe && !friendQueryRestricted()) {
    const bagForProbe = await getBagCached(true);
    const ownedForProbe = bagItemCount(bagForProbe, ITEM_SWEET_POTATO);
    const budget = Math.min(
      settings.autoProbeMaxPerRound,
      Math.max(0, ownedForProbe - settings.keepCount),
    );
    if (budget <= 0) {
      steps.push({ step: 'probe_skipped', reason: 'no_budget', owned: ownedForProbe, keepCount: settings.keepCount });
    }
    else {
      const candidatesForProbe = listProbeCandidates(settings, budget);
      if (!candidatesForProbe.length) {
        steps.push({ step: 'probe_skipped', reason: 'no_candidate' });
      }
      for (const candidate of candidatesForProbe) {
        try {
          const probed = await probeFriendShopPrice(candidate.gid, { force: false });
          steps.push({
            step: 'probe',
            gid: probed.gid,
            price: probed.price,
            spent: probed.spent,
            cached: probed.cached,
            historyMax: candidate.historyMax,
            ownPrice: shop.price,
          });
        }
        catch (error: any) {
          steps.push({ step: 'probe', gid: candidate.gid, error: String(error?.message || error).slice(0, 120) });
        }
      }
    }
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
        if (bestFriend && bestFriend.canSell !== false) {
          // 探价来的价格要过溢价阈值才卖，避免为了一条情报又低价出掉整批
          const ratio = toNum(bestFriend.price) / Math.max(1, toNum(shop.price)) * 100;
          const threshold = settings.autoProbeMinRatio;
          if (toNum(bestFriend.price) > toNum(shop.price) && ratio >= threshold) target = bestFriend;
          else steps.push({ step: 'sell_target_rejected', gid: bestFriend.gid, price: bestFriend.price, ownPrice: shop.price, ratio: Math.round(ratio), threshold });
        }
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
  saveShopTicket,
  getShopTicket,
  dropShopTicket,
  listShopTickets,
  probeFriendShopPrice,
  probePreview,
  getShopPrice,
  getShopPriceHistory,
  listShopPrices,
  runSweetPotatoAutomation,
};
