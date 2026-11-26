import type { NotificationTypes } from '../config/notification-types';
import type { RanchAutomationConfig } from '../config/ranch-automation';
export {};
export type PlantingStrategy =
  | 'preferred'
  | 'level'
  | 'max_exp'
  | 'max_fert_exp'
  | 'max_profit'
  | 'max_fert_profit'
  | 'bag_priority';

export type BagSeedFallbackStrategy = Exclude<PlantingStrategy, 'bag_priority'>;

export type FertilizerMode = 'both' | 'normal' | 'organic' | 'smart' | 'none' | 'normal_ripen' | 'organic_ripen';

export type FertilizerLandType = 'blue-crystal' | 'purple-gold' | 'gold' | 'black' | 'red' | 'normal';

/** 以薯换福出售档位：仅超高价 / 高价及以上 / 任意档位。 */
export type SweetPotatoPriceTier = 'super' | 'high' | 'any';

export interface AutomationConfig extends RanchAutomationConfig {
  // ===== 以薯换福（2026-11-25 抓包还原）=====
  /** 自动出售开关，默认关闭。 */
  sweetPotatoAutoSell?: boolean;
  /** 出售档位阈值，默认仅超高价。 */
  sweetPotatoPriceTier?: SweetPotatoPriceTier;
  /** 保留数量（留给兑换），默认 0。 */
  sweetPotatoKeepCount?: number;
  /** 检查间隔（分钟），默认 10。 */
  sweetPotatoCheckIntervalMinutes?: number;
  /** 自动兑换开关（兑换协议待补），默认关闭。 */
  sweetPotatoAutoExchange?: boolean;
  /** 出售给最高价好友（对比好友铺子价，高于自己铺子才卖），默认关闭。 */
  sweetPotatoSellToBestFriend?: boolean;
  /** 出售时间闸门 HH:MM，空串表示不限时段。 */
  sweetPotatoSellAfterTime?: string;
  /** 比价好友数量上限，默认 20。 */
  sweetPotatoScanFriendLimit?: number;
  /** 好友比价缓存时长（分钟），默认 120。 */
  sweetPotatoScanIntervalMinutes?: number;
  farm: boolean;
  farm_harvest_tiangong: boolean;
  farm_push: boolean;
  land_upgrade: boolean;
  friend: boolean;
  friend_auto_accept: boolean;
  friend_help_exp_limit: boolean;
  friend_steal: boolean;
  friend_help: boolean;
  friend_bad: boolean;
  friend_help_protect_dog_ignore_exp_limit: boolean;
  task: boolean;
  fertilizer_gift: boolean;
  fertilizer_buy_organic: boolean;
  fertilizer_buy_normal: boolean;
  mystery_shop_auto_buy: boolean;
  mystery_shop_allow_gold: boolean;
  mystery_shop_allow_coupon: boolean;
  mystery_shop_allow_gold_bean: boolean;
  mystery_shop_allow_diamond: boolean;
  mystery_shop_arrival_notify: boolean;
  mystery_shop_purchase_notify: boolean;
  sell: boolean;
  fertilizer: FertilizerMode;
  fertilizer_multi_season: boolean;
  fertilizer_land_types: FertilizerLandType[];
  fertilizer_smart_seconds: number;
  skip_own_weed_bug: boolean;
  show_manual_fertilizer: boolean;
}

export interface IntervalConfig {
  farm: number;
  farmMin: number;
  farmMax: number;
  friendMin: number;
  friendMax: number;
  helpMin: number;
  helpMax: number;
  stealMin: number;
  stealMax: number;
  [key: string]: number;
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
  continueFarm: boolean;
}

export interface AccountConfig {
  automation: AutomationConfig;
  plantingStrategy: PlantingStrategy;
  preferredSeedId: number;
  intervals: IntervalConfig;
  friendQuietHours: QuietHoursConfig;
  knownFriendGids: number[];
  knownFriendGidSyncCooldownSec: number;
  friendsListCacheTtlSec: number;
  friendBlacklist: number[];
  ranchFriendBlacklist: number[];
  plantBlacklist: number[];
  stealDelaySeconds: number;
  plantOrderRandom: boolean;
  plantDelaySeconds: number;
  fertilizerBuyOrganicCount: number;
  fertilizerBuyOrganicThresholdHours: number;
  fertilizerBuyNormalCount: number;
  fertilizerBuyNormalThresholdHours: number;
  fertilizerBuyCheckIntervalMinutes: number;
  /** 每天检查邮箱奖励的时间（0-23 点，默认 10 点）；到点后每天只触发一次。 */
  emailClaimHour: number;
  bagSeedPriority: number[];
  /** 是否为明确排在前面的多格背包种子保留尚未连成布局的空地。 */
  bagSeedMultiLandReservationEnabled: boolean;
  /** seedId -> 允许种植的土地类型。缺 key 视为不限制。 */
  bagSeedLandTypes: Record<string, FertilizerLandType[]>;
  bagSeedFallbackStrategy: BagSeedFallbackStrategy;
  autoAcceptFriendMinLevel: number;
  autoAcceptRequireOwnLevel: boolean;
  autoAcceptHarvestStealEnabled: boolean;
  autoAcceptHarvestStealHarvest: number;
  autoAcceptHarvestStealSteal: number;
}

export interface OfflineReminderChannel {
  channel: string;
  enabled: boolean;
  endpoint: string;
  token: string;
  secret: string;
}

export interface OfflineReminder {
  notificationTypes: NotificationTypes;
  channels: OfflineReminderChannel[];
  channel: string;
  endpoint: string;
  token: string;
  secret: string;
  title: string;
  msg: string;
  offlineDeleteSec: number;
}

export interface UIConfig {
  theme: 'light' | 'dark';
}

export interface LoginSettings {
  wechatQrLogin: boolean;
  qqQrLogin: boolean;
  napCatEndpoint: string;
  napCatSignature: string;
}

export interface DeviceInfo {
  os: string;
  clientVersion: string;
  sysSoftware: string;
  network: string;
  memory: string;
  deviceId: string;
  userAgent: string;
}

export interface SystemConfig {
  serverUrl: string;
  clientVersion: string;
  clientVersionUpdatedAt?: number;
  wxClientVersion: string;
  wxClientVersionUpdatedAt?: number;
  platform: string;
  os: string;
  timeZone: string;
  deviceInfo: DeviceInfo;
}

export interface GlobalConfig {
  accountConfigs: Record<string, AccountConfig>;
  defaultAccountConfig: AccountConfig;
  ui: UIConfig;
  loginSettings: LoginSettings;
  offlineReminder: OfflineReminder;
  systemConfig: SystemConfig | null;
}
