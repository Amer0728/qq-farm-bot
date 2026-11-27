# 以薯换福 开发笔记（含 qq-farm-bot-404 实现思路借鉴）

> 2026-11-26。本文记录协议模型、自动化与前端设计的约定，以及从 `muyuewang/qq-farm-bot-404` 移植/借鉴的具体内容。
> 代码位置：`core/src/services/sweet-potato.ts`、`core/src/proto/activitypb.proto`（Yshf* 段）、
> `core/src/controllers/admin/activity-center/sweet-potato-routes.ts`、`web/src/views/activity-center/SweetPotatoPage.vue`。

## 一、协议模型

活动组 `2026111707` / 主活动 `2026111708`（type=26）/ 副活动 `2026111709`（type=6，body 恒空）。
所有动作走 `ActivityService.Operate`：**f2 = cmd，参数与回包都挂在 190+cmd 槽位**。

| cmd | 语义 | 参数槽 | 回包槽 | 回包要点 |
| --- | --- | --- | --- | --- |
| 91 | 领每日红薯种子 | 191 | 191 | `grant{item_id=20307, count=28}` |
| 92 | 查铺子行情（只读） | 192 `{shop_gid}` | 192 | `quote{base, bonus, quota, shop} + can_sell` |
| 93 | 卖蜜薯 | 193 `{shop_gid, count}` | 193 | `count, price, total, quota, balance` |
| 95 | 收购记录 | 195 | 195 | `records[{ts, gid, count, total, name, avatar, level, commission}]` |
| 96 | 兑换下单 | 196 `{index, count}` | 196 | `price, grant{item_id, count}, balance` |
| 97 | 兑换目录 | 197 | 197 | `goods[{index, price, status, limit, ...}], balance` |
| 98 | 分享本人铺子 | 198 | 198 | `grant, price, shop{share_key}` |
| 99 | 领取收购提成 | 199 | 199 | `amount, balance` |

状态槽 `ActivityData.field_130`：

| 字段 | 含义 | 证据 |
| --- | --- | --- |
| `claims.seed_claimed / share_claimed` | 今日是否已领种子 / 已分享 | 本项目 f1 抓包 {1,1}；404 项目同日抓包交叉确认 |
| `share.bonus / timestamp` | 本次分享暴击加成 / 分享时间 | 本项目：分享后 bonus=66、ts=16:35 |
| `luck_coin` | 福气币余额 | 本项目 512505 → 兑换后 452505 |
| `base_price` / `bonus_price` | 当日基础价 / 暴击加成 | 本项目实测 88 + 66 = 154 |
| `capacity` | 本人铺子今日接收总量 | 本项目未分享 10000 → 分享后 17500 |
| `pending_commission` | 待领取收购提成 | 404 项目抓包 86 |

**两条铁律**：

1. **成交价恒为 `base_price + bonus_price`**，任何单字段都不能当成交价用。前端也只展示合计，另附拆分。
2. **`can_sell` 缺失 ≠ false**。服务端没下发时按"未知"处理，不要当成拒收。

## 二、自动化设计原则（借鉴 404，本项目已落地）

| 原则 | 做法 | 本项目实现 |
| --- | --- | --- |
| 幂等优先 | 领种子/分享前先读状态标记，已领已分享就不发写请求 | `runSweetPotatoAutomation` 读 `fetchActivityState().claims` |
| 时间闸门 | 出售不早于设定时刻（默认关闭），避免在好友还没暴击时贱卖 | `shouldSellNow()` + 设置项 `sellAfterTime` |
| 比价缓存 | 好友行情是实时只读查询，但逐家扫太贵，结果缓存 N 分钟 | `findBestFriendShop()` + `scanIntervalMinutes`（默认 120） |
| 单轮限次 | 一次只成交一家铺子，剩余留到下一轮 | 每轮只调一次 cmd 93 |
| 失败换家 | 额度不足/拒收/查不到不算整轮失败，换下一家 | `canSell === false` 过滤 + `quota >= sellable` 过滤 |
| 让路 | 网关不健康或后台繁忙时整轮跳过 | worker 里 `isGatewayHealthyForBusiness` |
| 串行 | 出售与兑换各自串行队列，避免并发重复扣货 | `serializeSell` / `serializeExchange` |
| 可观测 | 每轮输出结构化步骤，面板可回显 | `steps[]` + worker 日志「活动」标签 |

顺序固定为：**领种子 → 分享暴击 →（到点）比价出售 → 领提成 → 兑换**。
理由：领种子后当日行情才完整；暴击会抬高自己铺子价；提成是好友卖入后的被动收入，最后领不影响成交。

## 三、前端设计原则（借鉴 404 的 AGENTS 约定）

- **活动页与设置页职责分开**：活动页承载状态展示与手工操作，自动化开关统一放设置；手工入口必须复用后端同一套校验，不能为页面单开捷径。
- **首屏信息优先级**：活动名/剩余时间 → 当日成交价（含拆分）→ 库存与余额 → 决策信息（额度、可领提成）。同一数值不要在相邻卡片重复做主信息。
- **状态四态**：加载中 / 无账号 / 无数据 / 读取失败必须区分，不能用全零数据冒充成功。
- **刷新反馈**：刷新按钮要有 loading 与禁用，禁止并发重复请求。
- **素材来自真实截图或官方资源**，不用通用渐变替代；本项目图标是从兑换商店截图裁出的 10 张 PNG，放在 `web/public/activity-center/sweet/`，文件名 = 目录序号，前端按 `goodsId.png` 引用并留了缺图兜底。

## 四、本次从 404 移植的内容

| 项目 | 404 的做法 | 本项目落点 |
| --- | --- | --- |
| cmd 91 领种子 | 缺则领，回包取 grant | `claimSweetPotatoSeeds()` + 路由 `/claim-seed` + 面板按钮 |
| cmd 98 分享铺子 | 与 ShareService 上报组合触发暴击 | `triggerShareCrit()` 先发 98 再上报，两通道任一成功即可 |
| cmd 99 领提成 | 状态 `pending_commission > 0` 才领 | `claimSweetPotatoCommission()` + 面板按钮 |
| cmd 95 收购记录 | 列表展示最近记录 | `getSweetPotatoRecords()` + 面板「收购记录」 |
| `can_sell` | 三态处理 | `normalizeShop().canSell`（undefined = 未知） |
| `quota` 语义 | 剩余可收量，上限 8000 | `shop.quota` + 面板展示「已接收 capacity」 |
| 出售余额字段 | cmd 93 的 field 5 是余额 | 本项目已纠正：`sell_193.balance`（此前误标 day_price） |
| 时间闸门 | `yishu_sell_after_time` | `sellAfterTime` 设置项 + `shouldSellNow()` |
| 比价缓存/限次 | 120 分钟缓存、单轮 3 家 | 缓存 120 分钟；单轮成交 1 家（更保守） |
| 状态槽语义 | claims/share/luck_coin/capacity/pending_commission | 全部进 `YshfState`，前端只消费归一化结果 |

## 五、未移植 / 待办

1. **兑换目录的商品名**：协议只给 `index`，名称是客户端静态配置。本项目按界面核对写死 10 项；404 用 `inspect:cdn` 从官方配置表核对。后续可引入同类工具替代硬编码。
2. **cmd 96 的 `index` 与 `goods_id` 是否等价**：本项目实测用 `index=2` 下单成功并拿到 `item_id=1001`，但缺少 `index ≠ goods_id` 的样本，暂按等价处理。
3. **兑换策略**：当前按目录顺序贪心、每轮最多 3 件、余额不足即停。404 有更细的优先级配置，本项目先保简单可预测。
4. **活动窗口注册表**：404 有统一的活动窗口 + 过期自动关开关机制；本项目目前只在本服务内硬编码窗口常量。建议后续抽成注册表，供所有活动复用。
5. **素材映射 sha256 校验**：本项目图标是本地裁剪，尚无映射表与摘要校验；若改为协议下发路径解析，需要引入。

## 六、验证

```text
core typecheck / web typecheck  → 通过
core 测试                       → sweet-potato.test.js 10 项全过
                                  （含 92/93/96 请求逐字节一致、97 目录 10 档、状态槽 base/bonus/capacity/余额）
```
## 七、第二轮移植补充（2026-11-26 晚）

| 项 | 做法 |
| --- | --- |
| 兑换目录序号 → 官方道具 | 新增 `CATALOG_TEMPLATE`（index → item_id/name/price），来源为 404 的交叉核对结果 |
| 名称与图标解析 | 优先 `getItemById` / `getItemImageById` 从本地 `gameConfig` 解析；本地未收录的新道具回落模板名，图标由前端截图资源兜底 |
| 价格校验 | 服务端价格与模板不一致时置 `priceMismatch`，只做标记不在代码里改价 |
| 活动窗口 | `getSweetPotatoWindow()` 输出 `{beginSec, endSec, active, expired, notStarted}`，随状态接口下发 |
| 过期强制关闭 | `readSweetPotatoSettings()` 在窗口外把 `autoSell`/`autoExchange` 强制为 `false`，历史配置不能把定时任务再拉起来 |

已核实的道具映射（本地配置命中情况）：

| index | item_id | 名称 | 本地配置 |
| --- | --- | --- | --- |
| 1 | 204013 | 七色花弦 | ❌ 未收录（用模板名 + 截图图标） |
| 2 | 101627 | 福气金豆礼包 | ❌ 未收录 |
| 3 | 40522 | 金币果 | ✅ 官方图标 |
| 4 | 40523 | 经验蘑菇 | ✅ |
| 5 | 80011 | 有机化肥(1小时) | ✅ |
| 6 | 101620 | 南瓜种子礼包 | ✅ |
| 7 | 101621 | 荷风种子礼包 | ✅ |
| 8 | 101622 | 千星种子礼包 | ✅ |
| 9 | 101623 | 萌宠种子礼包 | ✅ |
| 10 | 80001 | 化肥(1小时) | ✅ |

> 8/10 走官方图标（`/game-config/seed_images_named/seed_images/<id>.png`），2 个新道具继续用截图裁出的 PNG。
> 等游戏配置表跟上后，把这两个 id 加进本地 `ItemInfo.json` 即可全量切到官方图标。

测试：`sweet-potato.test.js` 扩到 **12 项**，新增「序号映射官方道具」「活动窗口与过期标记」。
## 八、稳定性事故复盘（2026-11-26 18:00-18:20）

现象：账号登录成功后 15~25 秒内网关彻底静默（inbound 归零、心跳 miss 3/3 停机）。帧级日志定位到三个**自造**问题。

### 1. 活动 RPC 并发突发打断连接

```text
10:07:08.605 OUT Bag
10:07:08.605 OUT GetGroup        <- 同毫秒两条
10:07:08.633 IN  GetGroup 回包
                 <- Bag 再无回包，此后心跳也不再回
```

`getSweetPotatoState()` 原先用 `Promise.all` 同时拉「活动状态 / 铺子行情 / 背包」。
**改为串行 + 最小 250ms 间隔**（`pacedRpc`），背包加 30 秒缓存。

### 2. 串行队列自死锁（更隐蔽）

第一版修法把 `fetchActivityState` 外层又包了一层 `pacedRpc`，而它内部也用 `pacedRpc`：

```text
外层 pacedRpc 持有队列 -> 等内层完成
内层 pacedRpc 排在外层之后 -> 等外层释放
```

结果**一帧都不发**，接口 45s 超时。修复：一个动作只包一次，内层已串行的不要再包。

### 3. 接口超时预算过小

`API_CALL_TIMEOUTS_MS` 默认 10s。活动读接口要排在自动任务互斥锁后面、且自身串行，实测 3 条串联就超过 10s。
已在 `runtime/worker-manager.ts` 为 11 个活动方法单独放宽（读 30~45s、写 60s、整轮自动化 180s）。

### 4. 附带修复：WebSocket 握手头对齐

| 头 | 旧 | 新（官方抓包） |
| --- | --- | --- |
| Origin | `https://gate-obt.nqf.qq.com` | `file://` |
| Referer | 无 | `https://appservice.qq.com/1112386029/pc-v3.3.18/page-frame.html` |
| User-Agent | 微信小程序 UA | `... QQEX/9.9.37-54395 ... pcminiapp/3.3.18` |

修复后首次出现「AntiData 请求已收到有效回复」+「已收到并回灌非空 AntiData 响应」，会话稳定运行 167s 无掉线。

### 5. 关于 ACEVM 检查

服务端会在会话中下发 ACEVM 任务（本次 1044 字节），Node 宿主无法执行，返回失败状态。
**实测该失败不会导致断连**——任务之后心跳、AntiData 往返依旧正常。属于已知宿主限制，记录到 diagnostics 即可。

### 6. 排障工具

`FARM_FRAME_DEBUG=1` 启动后，双向原始帧写入 `core/data/logs/frames.log`（上限 500 帧）。
配合仓库根目录的 `read-frames.cjs` 解码，可直接看出「哪一帧发出后服务端不再回包」。这次三个问题全部由此定位。
## 九、设置持久化与手动执行的三个坑（2026-11-26 18:25-18:35）

接入真实账号后暴露的问题，全部修复：

### 1. 新设置键被存储层直接丢弃

`setAutomation(key, value)` → `applyConfigSnapshot` 里有一句：

```ts
if ((next.automation as any)[k] === undefined) continue;
```

键不在 `DEFAULT_ACCOUNT_CONFIG.automation` 里就被跳过。修复：把 9 个 `sweetPotato*` 键加进默认模板（`models/store/shared-state.ts`）。

### 2. automation 的值被强制布尔化

同一函数里通用分支是 `(next.automation as any)[k] = !!v;`，于是：

| 发送 | 落库 | 归一化后读到的 |
| --- | --- | --- |
| `keepCount: 5` | `true` | `1` |
| `priceTier: 'any'` | `true` | 回落 `'super'` |
| `sellAfterTime: '14:30'` | `true` | 回落 `''` |
| `scanIntervalMinutes: 90` | `true` | 回落 `120` |

修复：新增 `normalizeSweetPotatoSetting()`，按默认值的类型分派（布尔 / 枚举 / 数字 / `HH:MM`），并在分支里优先于通用 `!!v`。

### 3. 「立即执行一轮」会真的卖薯、花福气币

原实现 `if (settings.autoSell || manual)` / `if (settings.autoExchange || manual)`，手动模式下无视开关直接执行写操作。
修复：手动模式同样遵守开关，未开启时输出 `sell_skipped(auto_sell_disabled)` / `exchange_skipped(auto_exchange_disabled)`，只做只读判断。

### 真实账号验证结果（18:26-18:35）

```text
会话稳定   connected=true, uptime 593s 无掉线
状态接口   560ms  → 铺子 88+66=154、额度 8000、canSell=true；蜜薯 0、福气币 452505、种子 4
兑换目录   244ms  → 10 档、余额 452505、限购与界面一致、itemId 全部解析
收购记录   36ms   → 0 条（本人暂无好友卖入）
手动跑一轮 767ms  → claim_seed(已领) / share_crit(已生效 +66) / sell_skipped(未开启) / exchange_skipped(未开启)
```
## 十、设置持久化的最终方案（2026-11-26 19:40）

尝试过两条路，都不通，最后改成独立文件：

1. 放进 `automation`：键必须先在 `DEFAULT_ACCOUNT_CONFIG.automation` 里，否则被 `continue` 丢弃。加进去后键能存，但**值被强制布尔化**——写入时是 `7`，落库读回是 `true`。
2. 在 `applyConfigSnapshot` 里加 `normalizeSweetPotatoSetting()` 分支：打印确认分支走到了、返回值也是 `7`，但下一次读取依然是 `true`，说明布尔化发生在更下游的存储/还原链路，短期改不动。

**最终做法**：`core/data/sweet-potato-settings.json`，按账号 id 分桶，服务层自己读自己写（原子写 + 内存缓存）。

```text
保存: {priceTier:'any', keepCount:7, checkIntervalMinutes:20, sellToBestFriend:true,
       sellAfterTime:'21:45', scanFriendLimit:30, scanIntervalMinutes:180}
回显: 完全一致
重读: 完全一致（真账号实测）
```

活动窗口判断仍在读取时叠加：窗口外 `autoSell`/`autoExchange` 一律返回 `false`。

### 真账号最终验收（2026-11-26 19:44）

```text
连接       connected=true，Lv161（Code 由内存探针自动获取）
状态接口   297ms
           铺子 88+66=154，额度 8000；蜜薯 0，福气币 452505，种子 4
           领种子=true，已分享=true，接收总量 17500
手动跑一轮 全部只读跳过：claim_seed(已领) / share_crit(已生效+66) /
           sell_skipped(未开启) / exchange_skipped(未开启)
兑换目录   余额 452505，10 档，限购与界面一致
```
## 十一、页面按牧歌初启重构（2026-11-26 19:45）

参照 `websrc/views/activity-center/MugePage.vue` 的实现逻辑重写 `SweetPotatoPage.vue`：

| 层级 | 牧歌 | 以薯换福（重构后） |
| --- | --- | --- |
| 标题行 | 返回 + 图标 + 标题 + 活动期/剩余天数 + 活动说明/刷新 | 同结构 |
| 页签 | line 型，带 carbon 图标 | 红薯小铺 / 兑换商店 |
| 汇总条 | 数值 \| 进度 | 操作 | 今日收购价 154 \| 暴击占比进度条 | 状态徽标 |
| 卡片网格 | `auto-fill minmax(300px)` 横向小卡 | 库存 4 卡 + 每日动作 3 卡 + 兑换 10 卡 |
| 状态语义 | done / ready / idle / locked 四态 | 同四态（颜色与透明度一致） |

同时修掉一个真 bug：价格条一直显示「基础 0 · 暴击 +0」，原因是页面还在读旧 proto 字段名
`pricePartA/pricePartB/dailyQuota`，后端早已改为 `basePrice/bonusPrice/quota`。

样式全部复用牧歌的设计令牌（`--ui-surface` / `--ui-border` / `--ui-radius-card` /
`--ui-primary-soft` 等），不引入新色值；进度条用橙金渐变贴合活动主题。

验证：`typecheck:web` + `build:web` 通过；用浏览器实测两个页签与活动说明弹窗，截图确认布局。
## 十二、好友比价改为自动同步（2026-11-26 19:50）

原来「好友铺子比价」要手工输入 friendGid，现在改成自动从 QQ 好友列表抓 GID。

### 后端

- 新增 `getFriendShopRanking({ force, limit })`：`getFriendsList(false,'low')` 取好友 → 逐个 `fetchShopQuote`（走 `pacedRpc` 串行 250ms）→ 按当日价降序。
- 与自动出售共用同一份缓存（`friendRankCache` / `scanIntervalMinutes` 默认 120 分钟），界面带 `?force=1` 才重扫。
- 接口：`GET /api/activity-center/sweet-potato/friends`，worker 方法 `getSweetPotatoFriendRanking`，超时 150s（最多 60 位好友逐个读）。

### 前端

- 顶部显示「N 位好友 · 缓存 19:50」+「同步好友」按钮。
- 最高价单独一条横幅：`最高价 陵江 284/个 · 比我的铺子高 130` + 「卖 N 个给 TA」。
- 好友卡片网格：名字 / 等级 / 额度 / 单价 / 差价；比自己高的绿底高亮，低的半透明。
- 保留手动 GID 查询作为兜底。

### 实测（真账号）

```text
接口耗时 1956ms，扫描 6 位好友（上限 30）
我的铺子 154（基础 88 + 暴击 66）
  陵江            284  +130   额度 8000
  凉茶（二监）     214  +60    额度 8000
  不美不萌…       201  +47    额度 8000
  砂糖            185  +31    额度 7070
  RWY             151  -3     额度 8000
  小鲸鱼           84  -70    额度 8000
```

注意：好友铺子价格是**各自当日**的收购价（基础+暴击），与自己铺子不同步；
卖进好友铺子会占用对方每日接收额度，对方还拿提成 —— 界面已按这两点写提示。
## 十三、2026-11-28 客户端 1.17.1.13：好友行情被官方限制

### 版本更新

| 项 | 旧 | 新 |
| --- | --- | --- |
| 小程序包 | `1112386029_3_4477a59a…`（11-26 15:30） | `1112386029_3_bc5ac224…`（11-28 02:10） |
| 客户端版本 | `1.17.1.12_20261117` | **`1.17.1.13_20261117`** |
| TSDK | `v3.9.0.1795598781` / 161,127 B | **`v3.9.0.1795803021` / 161,123 B** |
| TSDK SHA256 | `7f8a7878…` | **`55dc21884da148879baeb60e06d7bf8b22d5dcb48fb27ef8157533f031230afd`** |

版本号取自内存探针观测到的握手串（诊断副本放宽版本校验并保留观测值），不是猜的。
探针 `GateVersion` 默认值同步改为 `1.17.1.13_20261117`。

### 好友铺子行情被封

`Operate 92` 传**他人 gid** 现在一律返回 **`1034184`**（活动操作失败，请刷新页面后重试）。

| 操作 | 结果 |
| --- | --- |
| 92 传本人 gid | ✅ 正常（价 132 = 99 + 33） |
| 92 传好友 gid（3 个好友逐个试） | ❌ 全部 1034184，250~760ms |
| 93 出售（自己/好友 gid，库存 0） | 都是 `1034178`（数量问题），说明 gid 校验没拦 |
| 95 收购记录 / 96 兑换 / 97 目录 / 99 提成 | ✅ 正常 |

结论：**只封了跨账号的行情查询**，出售通道本身没堵死；没有官方分享卡片拿不到可用行情，
因此「比价」在协议层暂时不可用。

### 降级处理

| 位置 | 处理 |
| --- | --- |
| `getFriendShopRanking` | 识别 1034184 立即 `break`，置 10 分钟负缓存，返回 `{ restricted: true, restrictedCode: 1034184, friends: [] }` |
| `findBestFriendShop` | 受限期内直接返回 `null`，自动出售退回「只卖自己铺子」，不再扫好友 |
| 前端 | 比价卡显示官方限制提示；「出售给最高价好友」开关置灰并标注暂不生效 |
| 错误码文案 | `1034184` = 官方已限制查看好友铺子行情；`1034178` = 蜜薯数量不足或活动状态异常 |

### 验证（真账号，1.17.1.13）

```text
登录          connected=true（新 TSDK + 新版本号）
好友接口      307ms → restricted=true, code=1034184, 条目 0, 自己价 132
状态接口      ok=true, 价 132, 蜜薯 0, 福气币 115025
出售/兑换/记录 不受影响
```

### 后续

- 官方若放开（或给出分享卡片带 key 的通道），把 `FRIEND_QUERY_BLOCKED_CODE` 判定去掉即可恢复比价。
- 若之后抓到「通过分享卡片进好友铺子」的请求体，按其中的新字段补齐 `Operate 92` 参数。
## 十四、好友行情票据机制（2026-11-28 深挖）

### 请求形态

抓包（用户在游戏里打开好友铺子）后解密客户端请求，Operate 92 的参数结构变了：

```text
f192 = {
  f1 = 1031121300                        目标铺子 gid
  f2 = {                                 新增：票据
    f1 = 2026111708                      活动 id
    f2 = 1031121300                      目标铺子 gid
    f3 = "1f35c32b-…-7dca64dd4baf"       服务端签发的 UUID
  }
}
```

对照：我们原先只发 f1，被拒 1034184。

### 票据不是客户端随机生成

| 实验 | 结果 |
| --- | --- |
| 随机 UUIDv4 填票据 | 仍 1034184 |
| 回放抓到的那个 UUID | **成功：价 452（155+297）、额度 800** |

而且这个 UUID 在本次抓包的所有回包里都搜不到（含 GetGroup / 92 回包，UUID 正则 0 命中），
说明它只随好友的分享卡片下发（走 QQ 消息通道，不经游戏 WSS）。
官方就是靠这个把「自动比价」堵死了：没有对方分享卡片就拿不到票据。

### 我们做的适配

| 层 | 改动 |
| --- | --- |
| proto | YshfShopTicket{activity_id, shop_gid, nonce}，YshfShopQueryParams 增加 ticket = 2 |
| 服务 | getSweetPotatoShop(gid, token)：查他人铺子必须带票据，缺失抛 SWEET_POTATO_TICKET_REQUIRED；extractShopToken 支持从分享链接抽 UUID |
| 接口 | POST /shop 接受 {gid, token} |
| 前端 | 比价卡多一个「粘贴好友分享卡片里的票据」输入框 |
| 自动化 | 仍保持受限降级：findBestFriendShop 在受限期返回 null，只卖自己铺子 |

### 验证

```text
编码一致    带票据的请求与官方抓包逐字节相同（已固化为测试）
不带票据    ok=false [SWEET_POTATO_TICKET_REQUIRED]
带票据      ok=true 价 452（155+297）额度 800
自动排行    restricted=true（符合预期）
测试        sweet-potato.test.js 14 项全过
```

### 结论

- 自动比价：协议层不可行（票据无法自取），保持受限降级。
- 手动比价 / 卖好友：拿到好友分享卡片后可用——填 gid + 票据即可查价；出售通道本身不需要票据。
- 若以后官方把票据放进某个回包，把 extractShopToken 换成从该回包取即可恢复自动比价。
