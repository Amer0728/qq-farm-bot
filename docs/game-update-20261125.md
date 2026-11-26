# 2026-11-25 游戏版本对齐：QQ 客户端 1.17.0.4 → 1.17.1.10

本轮对 PC 端 QQ 经典农场小程序做了完整 WSS 抓包，确认新版本号、替换 TSDK，并把登录/心跳请求体对齐到官方逐字节。本文记录证据、已改动项与待补项。

## 1. 版本与包信息

| 项 | 旧（仓库内） | 新（本轮实测） |
| --- | --- | --- |
| 小程序包版本 | 1.17.0.4 | **1.17.1.10** |
| 协议日期段 | 20261117 | 20261117（未变） |
| 握手 `ver` 参数 | 1.17.0.4_20261117 | **1.17.1.10_20261117** |
| TSDK | v3.9.0.1794737607（161,118 B） | **v3.9.0.1795522128（160,872 B）** |
| TSDK SHA-256 | ab6eb0f0…351ce74 | **c4ed27d0d1a6026402285a5b6a638608725fb0505b9ddf03ba74586d0cc5f136** |
| 网关 | wss://gate-obt.nqf.qq.com/prod/ws | 未变 |
| 加密开关 | jiami: true | 未变 |

小程序本地包路径（QQ NT 9.9.37，QQEX 内核）：

```text
%APPDATA%\QQEX\miniapp\temps\miniapp_src\1112386029_3_affe26190d5a99d886f5bb47e7381464\
├── project.config.json      projectname: client_1.17.1.10
├── game.json                Cocos 构建，subpackages: mcboot / __ccWasmAssetSubpkg__ / __ccWasmChunkSubpkg__
├── assets/resources/import/27/270bcfa0-….json
│     config.version = 1.17.1.10 / config.proto = 20261117 / defaultServer = wss://gate-obt.nqf.qq.com/prod/ws
└── tsdk/tsdk.wasm           160,872 B
```

## 2. 抓包方法

- 运行环境：QQ NT 9.9.37（`D:\QQ`），小程序宿主进程命令行含 `--exiapp=QQEXMiniProgram --miniapp-appid=1112386029`，浏览器内核 `--user-data-dir=%APPDATA%\QQEX`。
- 代理：mitmproxy 12.3.1 监听 `127.0.0.1:8888`，插件只劫持 `gate-obt.nqf.qq.com`，其余域名走 `http_connect` 原始隧道直通（不解密、不落盘）。
- 信任：mitmproxy CA 装入 `Cert:\CurrentUser\Root`（Chromium 内核按 Windows 证书库校验）。
- 触发重连：重启 QQEX 的 network service 进程，渲染层按 `webSocketReconnetTimeOut: 3000` 自动重连，无需人工重新登录。
- 落盘格式：每个 WSS 数据帧一个 `.bin`，内容为原始 `gatepb.Message`，可直接喂给 `tools/decode-latest-protocols.js` 与 `tools/audit-capture-compatibility.js`。

抓包结果：121 帧（57 SEND / 64 RECV），38,949 字节，覆盖 27 类 RPC/推送。

## 3. 协议证据

### 3.1 握手 URL

```text
wss://gate-obt.nqf.qq.com/prod/ws?os=Windows&ver=1.17.1.10_20261117&code=<32位>&platform=qq
```

### 3.2 心跳节奏

`ws_00064/68/72/76/82/88` 六次心跳间隔实测均为 **25.00 秒**，与仓库 `HEARTBEAT_INTERVAL` 设计一致；ACE `AntiData` 约每 25 秒产生一条非空负载（5 秒轮询、由 `M()` 决定是否产出），与文档描述吻合。

### 3.3 请求体逐字节比对

| RPC | 官方抓包 | 仓库构造 | 结果 |
| --- | --- | --- | --- |
| `UserService.PlayerLogin` | 76 B | 76 B | **完全一致**（对齐后） |
| `UserService.Heartbeat` | 28 B | 28 B | **完全一致** |

`PlayerLogin` 的变化点：1.17.1.10 的官方客户端在 `report_data` 中重新带上 `callback / cd_extend_info / click_id / clue_token / req_id / trackid` 六个空字段（1.17.0.4 抓包中缺省）。语义等价，但字节数从 64 增加到 76，现已按官方布局补齐。

`Heartbeat` 布局不变：`{gid, client_version, field_3:0}`。

### 3.4 TSDK 校验

- 新 `tsdk.wasm` 在现有 `tsdk-runtime.ts`（未改 `RUNTIME_TABLE` / `MERGED_DATA_KEY` / mergewasm 元数据）下初始化成功：`v3.9.0.1795522128`。
- 官方抓包中全部 SEND 帧可用新构建解密为合法 protobuf（Login / Heartbeat / AllLands / GetUserSettings / AntiData 等）。
- 未通过项：用离线环境复现官方一次性初始化凭据（`H()`）失败——本地输出 Base64 108 字符 / 81 字节，官方 152 字符 / 112 字节（`80 + openId 长度`）。该凭据依赖账号绑定的宿主上下文，离线无账号目录时不可复现，与历史结论一致，需要在真实账号会话下复核。

## 4. 协议差异清单（`audit-capture-compatibility.js` 输出）

### 4.1 字段缺失（本轮已补齐）

抓包统计到 8 处字段缺失，全部按"动态注入字段 + 解码看真实取值"的方式确认真实类型后补进 proto：

| 消息 | 字段 | wire | 类型 | 实测取值 / 处理方式 |
| --- | --- | --- | --- | --- |
| `plantpb.LandInfo.Buff` | 4, 5, 6 | 0 | `int64` | 6 级地 12500/5000/3000，5 级地 12000/4000/2500；量级与 1~3 不同，语义未解码 |
| `userpb.UserSettings` | 5 | 0 | `bool` | 恒为 1，开关型 |
| `emailpb.GetEmailListRequest` | 2 | 0 | `int32` | 恒为 1 |
| `seasonpb.GetSeasonInfoRequest` | 1 | 0 | `int32` | 恒为 1，与 `ActivityListRequest.game_scene_id` 同形 |
| `skinpb.SkinsOwnedReply` | 2 | 2 | `bytes` | `08e1e80c`（单字段 varint），保留原始字节 |
| `dogpb.DogInfo` | 12, 13 | 2 | `bytes` | 13 每条狗固定 `2003`（field_4=3）；12 仅部分狗出现，样例 `08babf051801` |
| `activitypb.ActivityData` | 124, 125, 126, 127, 130 | 2 | `bytes` | 新活动载荷：124 含 UTF8 名称、125 重复条目+头像列表、126 单值+条目、127 空消息、130 小结构 |
| `userpb.BasicInfo` | 16, 20, 21, 22 | 2/0 | `bytes` + `int64` | 映射 `PlayerLogin` 后新暴露：16 为嵌套消息（`08d10f`），20=48、21=1762046、22=240 |

> 约定：语义能确认的给真实类型；只能确认"是嵌套消息但内部结构未解"的，用 `bytes` 原样保留并在注释里贴样例字节，既不丢数据也不臆造字段名。

### 4.2 缺少 RPC 映射（本轮已补）

- `gamepb.userpb.UserService.PlayerLogin`
- `gamepb.globalscenepb.GlobalSceneService.PlayerSceneLogin`
- `msgboardpb.MsgBoardService.GetMsgBoardProfile` —— 新建 `proto/msgboardpb.proto`
- `gamepb.iaapb.IaaService.GetAdUnits` —— 新建 `proto/iaapb.proto`
- `gamepb.solartermspb.SolarTermsV2Service.GetSolarTermsV2RedDot` —— 补进 `solartermspb.proto`（新旧服务并行调用）

新服务的报文结构均由抓包还原：

```text
MsgBoard.GetMsgBoardProfile   请求 {gid}；回包 {profile{signature, updated_at, welcome{...}, token, field_8}}
Iaa.GetAdUnits                请求 {field_1=0}；回包 {units[{id, ad_unit_id, app_id}]}
SolarTermsV2.GetSolarTermsV2RedDot   请求/回包均为空消息
```

### 4.3 补齐后的审计结果

```text
Audited 129 protocol frames across 32 RPC/notify types.
No unknown fields, wire mismatches, or missing message types found.
```

本轮抓包的全部 129 帧、32 类 RPC/推送，对本地 proto 已是零未知字段、零 wire 不匹配、零缺失类型。

## 5. 已应用的改动

| 文件 | 改动 |
| --- | --- |
| `core/src/config/config.ts` | `DEFAULT_CLIENT_VERSION = '1.17.1.10_20261117'`，`DEFAULT_CLIENT_VERSION_UPDATED_AT` 同步 |
| `core/src/utils/tsdk.wasm` | 替换为 1.17.1.10 包内构建（160,872 B） |
| `core/src/utils/tsdk-runtime.ts` | `TSDK_VERSION / TSDK_SHA256` 更新为新构建 |
| `core/src/utils/network.ts` | `buildLoginBody` 的 `report_data` 补齐六个空字段，与官方 76 字节对齐（仅 QQ 分支） |
| `core/src/proto/plantpb.proto` | `LandInfo.Buff` 补 4/5/6 |
| `core/src/proto/userpb.proto` | `UserSettings` 补 5；`BasicInfo` 补 16/20/21/22 |
| `core/src/proto/activitypb.proto` | `ActivityData` 补 124/125/126/127/130 |
| `core/src/proto/dogpb.proto` | `DogInfo` 补 12/13 |
| `core/src/proto/skinpb.proto` / `emailpb.proto` / `seasonpb.proto` | 各补 1 个字段 |
| `core/src/proto/solartermspb.proto` | 新增 `GetSolarTermsV2RedDotRequest/Reply` |
| `core/src/proto/msgboardpb.proto` | **新建**：留言板资料请求/回包 |
| `core/src/proto/iaapb.proto` | **新建**：IAA 广告位请求/回包 |
| `core/src/utils/proto.ts` | 加载清单加入 `msgboardpb.proto`、`iaapb.proto` |
| `tools/audit-capture-compatibility.js` | `rpcTypes` 补 5 条映射（含 PlayerLogin/PlayerSceneLogin） |
| `tools/decode-latest-protocols.js` | `selected` 补 5 个新方法，解码时默认输出 |

验证：`pnpm -C core typecheck` 通过；`build:ts` 通过；后端启动冒烟通过（`/api/game-version` 返回 `1.17.1.10_20261117`，49 个 proto 全量加载无报错）。

## 6. 待补项

1. **测试向量**：`core/tests` 中冻结的版本常量与 TSDK 向量需按新构建更新，其中 `tsdk-runtime.test.js` 的 `H()` 冻结向量需要同构建官方会话才能重建（本轮离线不可得）。
2. **字段语义**：`Buff.field_4/5/6`、`DogInfo.field_12/13`、`ActivityData.field_124~130`、`BasicInfo.field_16/20/21/22` 目前只保证"解码不丢、可回编码"，含义仍需实机对照（例如改种、施肥、升级前后对比取值）才能命名。其中 `Buff.field_4` 与产量相关，若要参与收益计算须先确认量纲。
3. **新服务接入**：`msgboardpb`（留言板签名）与 `iaapb`（激励广告位）协议面已完整，脚本当前不调用；是否接入由产品决定。`SolarTermsV2` 本次回包为空，需要活动开放时再抓一次确认字段。
4. **微信侧**：本轮仅覆盖 QQ，微信 `tsdk-wx.wasm` 与版本未验证；因此 `report_data` 的六字段补全只作用于 QQ 分支，微信维持原布局。

## 6.1 测试基线

改动前后 `node --test core/tests/*.test.js` 均为 **295 项 / 278 通过 / 17 失败**，失败集合完全相同，均为版本升级遗留的冻结向量（`DEFAULT_CLIENT_VERSION`、旧 TSDK 哈希、`H()` 凭据向量等）与本轮无关。本轮顺手修正了一处测试前提：`wechat-connection.test.js` 之前把微信分支的 `client_version` 断言成 `DEFAULT_CLIENT_VERSION`，两个默认值相等时凑巧通过；版本分离后暴露，已改为 `DEFAULT_WX_CLIENT_VERSION`。

## 7. 复现与再抓包

```powershell
# 1) 启动抓包代理（只劫持游戏网关）
mitmdump -p 8888 --set block_global=false -s <capture-dir>/addon.py
# 2) 系统代理指向 127.0.0.1:8888，并信任 mitmproxy CA（certutil -user -addstore Root mitmproxy-ca-cert.cer）
# 3) 重启 QQEX network service 触发重连，或在游戏内重新进入农场
# 4) 解码 / 审计
pnpm -C core exec tsx ../tools/decode-latest-protocols.js <capture-dir> --all --summary
pnpm -C core exec tsx ../tools/audit-capture-compatibility.js <capture-dir>
```
