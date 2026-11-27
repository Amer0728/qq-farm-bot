<script setup lang="ts">
import { NButton } from 'naive-ui/es/button'
import { NInput } from 'naive-ui/es/input'
import { NInputNumber } from 'naive-ui/es/input-number'
import { NModal } from 'naive-ui/es/modal'
import { NSelect } from 'naive-ui/es/select'
import { NSwitch } from 'naive-ui/es/switch'
import { NTab, NTabs } from 'naive-ui/es/tabs'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'
import api, { getApiErrorMessage } from '@/api'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const emit = defineEmits<{ back: [] }>()

const accountStore = useAccountStore()
const toast = useToastStore()
const { currentAccountId } = storeToRefs(accountStore)

const ACTIVITY_END_SEC = 1796831999
const ACTIVITY_BEGIN_LABEL = '11月25日'
const ACTIVITY_END_LABEL = '12月9日'

const RULES: string[] = [
  '活动期间，农场主可在主界面进入「以薯换福」，通过领取红薯种子、种植红薯额外收获蜜薯。',
  '售卖蜜薯获得福气币，并兑换盆栽·七彩花弦、福气金豆礼包与实用道具。',
  '当日首次进入活动自动弹出「今日售价」，可领取红薯种子。',
  '红薯种子种入普通农田，成熟后收获红薯，并额外收获蜜薯。',
  '蜜薯可卖给自己铺子，按本人当日收购价出售，不限量；也可通过好友分享的红薯铺卡片进入好友铺子售卖，按对方铺子当日价格出售，占用对方每日接收额度，好友还会获得福气币分红。',
  '每日首次成功把自己的铺子分享给 QQ/微信好友或群聊，即触发一次分享暴击；暴击涨价每日 0 点清零，次日重新触发。',
  '每日 24:00，系统自动按本人铺子当日最终收购价售出玩家持有的全部蜜薯，福气币入账，蜜薯清零。',
]

interface ShopInfo {
  gid: string
  name: string
  avatarUrl: string
  level: number
  basePrice: number
  bonusPrice: number
  price: number
  quota: number
  canSell?: boolean
  isSelf?: boolean
}

interface SweetPotatoSettings {
  autoSell: boolean
  priceTier: 'super' | 'high' | 'any'
  keepCount: number
  checkIntervalMinutes: number
  autoExchange: boolean
  sellToBestFriend: boolean
  sellAfterTime: string
  scanFriendLimit: number
  scanIntervalMinutes: number
}

const tierOptions = [
  { label: '攒暴击再卖（超高价）', value: 'super' },
  { label: '攒暴击再卖（高价）', value: 'high' },
  { label: '随时按当前价卖', value: 'any' },
]

const tab = ref<'shop' | 'exchange'>('shop')
const rulesOpen = ref(false)
const loading = ref(false)
const selling = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const state = ref<any>(null)
const settings = ref<SweetPotatoSettings>({
  autoSell: false,
  priceTier: 'super',
  keepCount: 0,
  checkIntervalMinutes: 10,
  autoExchange: false,
  sellToBestFriend: false,
  sellAfterTime: '',
  scanFriendLimit: 20,
  scanIntervalMinutes: 120,
})
const records = ref<any[]>([])
const recordsLoading = ref(false)
const acting = ref('')

const friends = ref<any[]>([])
const friendMeta = ref('')
const friendListLoading = ref(false)
const friendRestricted = ref(false)
const restrictedCode = ref(0)
const harvesting = ref(false)
const friendGid = ref('')
const friendToken = ref('')
const friendShop = ref<ShopInfo | null>(null)
const friendError = ref('')
const friendLoading = ref(false)
const sellCount = ref(1)

const exchange = ref<{ balance: number, items: any[] } | null>(null)
const exchangeError = ref('')
const exchangeLoading = ref(false)
const buyingId = ref('')
const iconBroken = ref(false)
const brokenIcons = ref<Record<string, boolean>>({})
const runLoading = ref(false)
const runResult = ref<any[] | null>(null)

const price = computed(() => state.value?.shop?.price ?? 0)
const priceBase = computed(() => state.value?.shop?.basePrice ?? 0)
const priceBoost = computed(() => state.value?.shop?.bonusPrice ?? 0)
const quota = computed(() => state.value?.shop?.quota ?? 0)
const canSell = computed(() => state.value?.shop?.canSell !== false)
const bonusPercent = computed(() => {
  const total = priceBase.value + priceBoost.value
  return total > 0 ? Math.round(priceBoost.value / total * 100) : 0
})
const seedClaimed = computed(() => state.value?.activity?.claims?.seedClaimed === true)
const seedCount = computed(() => state.value?.seedCount ?? 0)
const sweetPotato = computed(() => state.value?.sweetPotato ?? 0)
const fortuneCoin = computed(() => state.value?.luckCoin ?? 0)
const capacity = computed(() => state.value?.activity?.capacity ?? 0)
const pendingCommission = computed(() => state.value?.activity?.pendingCommission ?? 0)
const sellable = computed(() => Math.max(0, sweetPotato.value - Number(settings.value.keepCount || 0)))
const daysLeft = computed(() => Math.max(0, Math.ceil((ACTIVITY_END_SEC * 1000 - Date.now()) / 86400000)))
const boosted = computed(() => Number(priceBoost.value) > 0)

function itemIcon(id: number | string) {
  return `/game-config/seed_images_named/seed_images/${id}.png`
}

function accountId() {
  return String(currentAccountId.value || '')
}

async function load() {
  if (!accountId()) {
    error.value = '请先选择账号'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const response = await api.get('/api/activity-center/sweet-potato', { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      error.value = getApiErrorMessage(response.data, '无法读取以薯换福数据')
      return
    }
    state.value = response.data.data
    if (state.value?.settings)
      settings.value = { ...settings.value, ...state.value.settings }
    sellCount.value = Math.max(1, sellable.value || 1)
  }
  catch (cause: any) {
    error.value = getApiErrorMessage(cause, '无法读取以薯换福数据')
  }
  finally {
    loading.value = false
  }
}

async function loadExchange() {
  if (!accountId())
    return
  exchangeLoading.value = true
  exchangeError.value = ''
  try {
    const response = await api.get('/api/activity-center/sweet-potato/exchange', { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      exchangeError.value = getApiErrorMessage(response.data, '无法读取兑换商店')
      return
    }
    exchange.value = response.data.data
  }
  catch (cause: any) {
    exchangeError.value = getApiErrorMessage(cause, '无法读取兑换商店')
  }
  finally {
    exchangeLoading.value = false
  }
}

/** 好友铺子排行：后台自动从 QQ 好友列表取 GID 并逐个读行情，界面只消费结果。 */
async function loadFriends(force = false) {
  if (!accountId())
    return
  friendListLoading.value = true
  friendError.value = ''
  try {
    const response = await api.get(`/api/activity-center/sweet-potato/friends${force ? '?force=1' : ''}`, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      friendError.value = getApiErrorMessage(response.data, '无法读取好友铺子比价')
      return
    }
    const data = response.data.data
    friendRestricted.value = data?.restricted === true
    restrictedCode.value = Number(data?.restrictedCode || 0)
    friends.value = Array.isArray(data?.friends) ? data.friends : []
    const stamp = data?.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
    friendMeta.value = data?.restricted
      ? '官方已限制好友行情'
      : `${data?.scanned ?? 0} 位好友 · ${data?.cached ? '缓存' : '刚刚同步'}${stamp ? ` ${stamp}` : ''}`
  }
  catch (cause: any) {
    friendError.value = getApiErrorMessage(cause, '无法读取好友铺子比价')
  }
  finally {
    friendListLoading.value = false
  }
}

/** 从 QQ 渲染进程内存只读采集票据（需先在游戏里打开过好友铺子）。 */
async function harvestTickets() {
  harvesting.value = true
  try {
    const response = await api.post('/api/activity-center/sweet-potato/harvest', {}, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      toast.error(getApiErrorMessage(response.data, '采集票据失败'))
      return
    }
    const data = response.data.data
    notice.value = data?.saved
      ? `采集到 ${data.saved} 位好友的票据，已入库`
      : `扫到 ${data?.found ?? 0} 条，但没有新的可入库票据（先在游戏里打开好友铺子再试）`
    await loadFriends(true)
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '采集票据失败'))
  }
  finally {
    harvesting.value = false
  }
}

async function sellTo(gid: string, count: number) {
  if (!state.value || count <= 0)
    return
  selling.value = true
  try {
    const response = await api.post('/api/activity-center/sweet-potato/sell', { gid, count }, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      toast.error(getApiErrorMessage(response.data, '出售失败'))
      return
    }
    const result = response.data.data
    notice.value = `已卖出 ${result.count} 个蜜薯，收入 ${result.totalGain} 福气币（单价 ${result.unitPrice}）`
    await Promise.all([load(), loadExchange()])
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '出售失败'))
  }
  finally {
    selling.value = false
  }
}

async function loadFriend() {
  const gid = friendGid.value.trim()
  friendError.value = ''
  friendShop.value = null
  if (!/^\d+$/.test(gid)) {
    friendError.value = '请输入正确的玩家 GID'
    return
  }
  friendLoading.value = true
  try {
    const response = await api.post('/api/activity-center/sweet-potato/shop', { gid, token: friendToken.value.trim() }, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      friendError.value = getApiErrorMessage(response.data, '无法读取该玩家铺子')
      return
    }
    friendShop.value = response.data.data
  }
  catch (cause: any) {
    friendError.value = getApiErrorMessage(cause, '无法读取该玩家铺子')
  }
  finally {
    friendLoading.value = false
  }
}

async function sell() {
  if (!state.value)
    return
  const count = Number(sellCount.value)
  if (!Number.isInteger(count) || count <= 0) {
    toast.error('出售数量必须是正整数')
    return
  }
  selling.value = true
  try {
    const response = await api.post('/api/activity-center/sweet-potato/sell', {
      gid: state.value.gid,
      count,
    }, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      toast.error(getApiErrorMessage(response.data, '出售失败'))
      return
    }
    const result = response.data.data
    notice.value = `已卖出 ${result.count} 个蜜薯，收入 ${result.totalGain} 福气币（单价 ${result.unitPrice}）`
    await load()
    await loadExchange()
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '出售失败'))
  }
  finally {
    selling.value = false
  }
}

async function buy(item: any) {
  buyingId.value = item.goodsId
  try {
    const response = await api.post('/api/activity-center/sweet-potato/exchange', {
      index: item.index,
      count: 1,
    }, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      toast.error(getApiErrorMessage(response.data, '兑换失败'))
      return
    }
    const result = response.data.data
    notice.value = `已兑换 ${result.name} × ${result.count}，消耗 ${result.cost} 福气币`
    exchange.value = { balance: result.balance, items: result.items }
    await load()
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '兑换失败'))
  }
  finally {
    buyingId.value = ''
  }
}

async function saveSettings() {
  saving.value = true
  try {
    const response = await api.post('/api/activity-center/sweet-potato/settings', settings.value, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      toast.error(getApiErrorMessage(response.data, '保存设置失败'))
      return
    }
    settings.value = { ...settings.value, ...response.data.data }
    notice.value = '设置已保存'
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '保存设置失败'))
  }
  finally {
    saving.value = false
  }
}

async function runOnce() {
  runLoading.value = true
  runResult.value = null
  try {
    const response = await api.post('/api/activity-center/sweet-potato/run', {}, { skipErrorToast: true } as any)
    if (!response.data?.ok) {
      toast.error(getApiErrorMessage(response.data, '执行失败'))
      return
    }
    const data = response.data.data
    if (data?.skipped)
      notice.value = data.skipped === 'activity_closed' ? '活动已结束' : '自动化已关闭，本轮只跑了只读步骤'
    runResult.value = Array.isArray(data?.steps) ? data.steps : []
    await load()
    await loadExchange()
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '执行失败'))
  }
  finally {
    runLoading.value = false
  }
}

async function claimSeed() {
  acting.value = 'seed'
  try {
    const response = await api.post('/api/activity-center/sweet-potato/claim-seed', {}, { skipErrorToast: true } as any)
    if (!response.data?.ok)
      toast.error(getApiErrorMessage(response.data, '领取种子失败'))
    else
      notice.value = `已领取红薯种子 × ${response.data.data?.count ?? 0}`
    await load()
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '领取种子失败'))
  }
  finally {
    acting.value = ''
  }
}

async function claimCommission() {
  acting.value = 'commission'
  try {
    const response = await api.post('/api/activity-center/sweet-potato/claim-commission', {}, { skipErrorToast: true } as any)
    if (!response.data?.ok)
      toast.error(getApiErrorMessage(response.data, '领取提成失败'))
    else
      notice.value = `已领取收购提成 ${response.data.data?.amount ?? 0}，余额 ${response.data.data?.balance ?? 0}`
    await load()
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '领取提成失败'))
  }
  finally {
    acting.value = ''
  }
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const response = await api.get('/api/activity-center/sweet-potato/records', { skipErrorToast: true } as any)
    if (!response.data?.ok)
      toast.error(getApiErrorMessage(response.data, '读取收购记录失败'))
    else
      records.value = Array.isArray(response.data.data) ? response.data.data : []
  }
  catch (cause: any) {
    toast.error(getApiErrorMessage(cause, '读取收购记录失败'))
  }
  finally {
    recordsLoading.value = false
  }
}

const bestFriend = computed(() => friends.value.find((one: any) => one.better) || null)

async function refreshAll() {
  await Promise.all([load(), loadExchange(), loadFriends()])
}

onMounted(refreshAll)
</script>
<template>
  <section class="sweet">
    <!-- 标题行：与牧歌初启同一种结构（返回 + 图标 + 标题 + 活动期 + 说明/刷新）。 -->
    <header class="sweet-head">
      <div class="sweet-head__lead">
        <NButton quaternary circle title="返回活动列表" aria-label="返回活动列表" @click="emit('back')">
          <template #icon>
            <span class="i-carbon-arrow-left" />
          </template>
        </NButton>
        <img
          v-if="!iconBroken"
          src="/activity-assets/sweet/icon.png"
          alt=""
          width="32"
          height="32"
          class="sweet-head__icon"
          @error="iconBroken = true"
        >
        <div class="sweet-head__text">
          <h1>以薯换福</h1>
          <p>
            <span class="i-carbon-calendar" aria-hidden="true" />{{ ACTIVITY_BEGIN_LABEL }} – {{ ACTIVITY_END_LABEL }}
            <span class="sweet-head__badge" :class="{ 'is-ended': daysLeft === 0 }">{{ daysLeft === 0 ? '已结束' : `还剩 ${daysLeft} 天` }}</span>
          </p>
        </div>
      </div>
      <div class="sweet-head__actions">
        <NButton quaternary title="活动说明" aria-label="活动说明" @click="rulesOpen = true">
          <template #icon>
            <span class="i-carbon-information" />
          </template>
          <span class="sweet-head__rules">活动说明</span>
        </NButton>
        <NButton quaternary circle :loading="loading" title="刷新活动" aria-label="刷新活动" @click="refreshAll">
          <template #icon>
            <span class="i-carbon-renew" />
          </template>
        </NButton>
      </div>
    </header>

    <NTabs v-model:value="tab" type="line" class="sweet-tabs" aria-label="以薯换福玩法">
      <NTab name="shop">
        <span class="sweet-tab"><span class="i-carbon-store" aria-hidden="true" />红薯小铺<i v-if="pendingCommission > 0 || !seedClaimed" class="sweet-tab__dot" /></span>
      </NTab>
      <NTab name="exchange">
        <span class="sweet-tab"><span class="i-carbon-gift" aria-hidden="true" />兑换商店</span>
      </NTab>
    </NTabs>

    <div class="sweet-content">
      <p v-if="error" class="sweet-error" role="alert">
        <span class="i-carbon-warning-alt" aria-hidden="true" />{{ error }}
      </p>
      <p v-if="notice" class="sweet-notice">
        <span class="i-carbon-checkmark-outline" aria-hidden="true" />{{ notice }}
      </p>

      <div v-if="!currentAccountId" class="sweet-empty">
        <span class="i-carbon-user-avatar" aria-hidden="true" />
        <p>请先选择账号</p>
      </div>
      <div v-else-if="!state && loading" class="sweet-empty">
        <span class="i-svg-spinners-90-ring-with-bg" aria-hidden="true" />
        <p>正在读取活动进度</p>
      </div>

      <!-- 红薯小铺 -->
      <template v-else-if="tab === 'shop' && state">
        <section class="sweet-card sweet-bar">
          <div class="sweet-bar__value">
            <span>今日收购价</span>
            <strong>{{ price }}<small>福气币 / 个</small></strong>
          </div>
          <div class="sweet-bar__progress">
            <div class="sweet-track" aria-hidden="true">
              <i :style="{ width: `${bonusPercent}%` }" />
            </div>
            <span>
              基础 {{ priceBase }} + 暴击 <b>{{ priceBoost }}</b>
              <em> · {{ boosted ? '今日暴击已触发' : '今日尚未触发暴击' }} · 铺子已接收 {{ capacity.toLocaleString('zh-CN') }}</em>
            </span>
          </div>
          <span class="sweet-status" :class="boosted ? 'is-done' : 'is-idle'">
            <span v-if="boosted" class="i-carbon-checkmark" aria-hidden="true" />{{ boosted ? '暴击已生效' : '待分享触发' }}
          </span>
        </section>

        <div class="sweet-grid is-small">
          <article class="sweet-card sweet-item">
            <span class="sweet-item__well"><img :src="itemIcon(1032)" alt=""></span>
            <div class="sweet-item__main">
              <strong>蜜薯存量</strong>
              <span>可售 <b>{{ sellable }}</b> 个</span>
            </div>
          </article>
          <article class="sweet-card sweet-item">
            <span class="sweet-item__well"><img :src="itemIcon(1033)" alt=""></span>
            <div class="sweet-item__main">
              <strong>福气币</strong>
              <span>现有 <b>{{ fortuneCoin.toLocaleString('zh-CN') }}</b></span>
            </div>
          </article>
          <article class="sweet-card sweet-item">
            <span class="sweet-item__well"><img :src="itemIcon(20307)" alt=""></span>
            <div class="sweet-item__main">
              <strong>红薯种子</strong>
              <span>背包 <b>{{ seedCount }}</b> 个</span>
            </div>
          </article>
          <article class="sweet-card sweet-item">
            <span class="sweet-item__well"><span class="i-carbon-data-base" aria-hidden="true" /></span>
            <div class="sweet-item__main">
              <strong>铺子接收额度</strong>
              <span>还能再收 <b>{{ quota }}</b></span>
            </div>
          </article>
        </div>

        <!-- 每日动作：与牧歌档位卡同一种横向卡片 -->
        <div class="sweet-grid">
          <article class="sweet-card sweet-item" :class="seedClaimed ? 'is-done' : 'is-ready'">
            <span class="sweet-item__well"><img :src="itemIcon(20307)" alt=""></span>
            <div class="sweet-item__main">
              <strong>领取红薯种子</strong>
              <span>{{ seedClaimed ? '今日已领取' : '每日一次，领完才会生成当日行情' }}</span>
            </div>
            <span v-if="seedClaimed" class="sweet-status is-done">
              <span class="i-carbon-checkmark" aria-hidden="true" />已领取
            </span>
            <NButton v-else size="small" type="primary" :loading="acting === 'seed'" @click="claimSeed">领取</NButton>
          </article>

          <article class="sweet-card sweet-item" :class="pendingCommission > 0 ? 'is-ready' : 'is-idle'">
            <span class="sweet-item__well"><img :src="itemIcon(1033)" alt=""></span>
            <div class="sweet-item__main">
              <strong>收购提成</strong>
              <span>好友把蜜薯卖进你的铺子后产生</span>
            </div>
            <NButton v-if="pendingCommission > 0" size="small" type="primary" :loading="acting === 'commission'" @click="claimCommission">
              领取 {{ pendingCommission }}
            </NButton>
            <span v-else class="sweet-status is-idle">暂无提成</span>
          </article>

          <article class="sweet-card sweet-item">
            <span class="sweet-item__well"><span class="i-carbon-list-checked" aria-hidden="true" /></span>
            <div class="sweet-item__main">
              <strong>收购记录</strong>
              <span>只展示最近的收购明细</span>
            </div>
            <NButton size="small" secondary :loading="recordsLoading" @click="loadRecords">查看</NButton>
          </article>
        </div>

        <div v-if="records.length" class="sweet-grid">
          <article v-for="(record, index) in records" :key="index" class="sweet-card sweet-item is-compact">
            <span class="sweet-item__well"><span class="i-carbon-user-multiple" aria-hidden="true" /></span>
            <div class="sweet-item__main">
              <strong>{{ record.name || record.gid }}</strong>
              <span>买入 <b>{{ record.count }}</b> 个，付款 <b>{{ record.total }}</b></span>
            </div>
            <span class="sweet-status is-done">分红 {{ record.commission }}</span>
          </article>
        </div>

        <!-- 出售 -->
        <section class="sweet-card sweet-panel">
          <div class="sweet-panel__head">
            <h2>出售蜜薯</h2>
            <span class="sweet-panel__hint">24:00 系统按当日最终价自动结算剩余蜜薯</span>
          </div>
          <div class="sweet-panel__row">
            <NInputNumber v-model:value="sellCount" :min="1" :max="Math.max(1, sweetPotato)" size="small" class="sweet-num" :show-button="false" />
            <span class="sweet-panel__meta">可售 {{ sellable }} 个 · 单价 {{ price }}</span>
            <NButton type="primary" :disabled="sellable <= 0 || !canSell" :loading="selling" @click="sell">
              出售到我的铺子
            </NButton>
          </div>
          <p v-if="!canSell" class="sweet-panel__warn">服务端标记该铺子当前不接收蜜薯</p>
        </section>

        <!-- 好友比价：GID 自动从 QQ 好友列表同步，无需手填 -->
        <section class="sweet-card sweet-panel">
          <div class="sweet-panel__head">
            <h2>好友铺子比价</h2>
            <div class="sweet-panel__row">
              <span class="sweet-panel__hint">{{ friendMeta || '按对方铺子当日收购价结算' }}</span>
              <NButton size="tiny" :loading="harvesting" @click="harvestTickets">采集票据</NButton>
              <NButton size="tiny" :loading="friendListLoading" @click="loadFriends(true)">同步好友</NButton>
            </div>
          </div>

          <p v-if="friendError" class="sweet-panel__warn">{{ friendError }}</p>
          <p v-if="friendRestricted" class="sweet-panel__warn">
            官方从 1.17.1.13 起要求好友铺子行情必须带<strong>对方分享卡片里的票据</strong>，无法自动获取（错误码 {{ restrictedCode || 1034184 }}）。
            自己铺子、出售、兑换、收购记录不受影响；自动出售会退回只卖自己的铺子。
            拿到好友分享链接后，把下面的 gid 和票据填上就能查价并卖给他。
          </p>

          <div v-if="bestFriend" class="sweet-friend">
            <span class="sweet-friend__name">最高价 {{ bestFriend.name || bestFriend.gid }}</span>
            <span class="sweet-friend__price">{{ bestFriend.price }}<small>/个</small></span>
            <span class="sweet-status is-done">比我的铺子高 {{ bestFriend.delta }}</span>
            <NButton size="tiny" type="primary" :disabled="sellable <= 0 || bestFriend.quota < sellable" :loading="selling" @click="sellTo(bestFriend.gid, sellable)">
              卖 {{ sellable }} 个给 TA
            </NButton>
          </div>

          <div v-if="friends.length" class="sweet-grid is-small">
            <article v-for="friend in friends" :key="friend.gid" class="sweet-card sweet-item is-compact" :class="friend.better ? 'is-ready' : 'is-idle'">
              <span class="sweet-item__well"><span class="i-carbon-user-avatar" aria-hidden="true" /></span>
              <div class="sweet-item__main">
                <strong>{{ friend.name || friend.gid }}</strong>
                <span>Lv{{ friend.level || '-' }} · 额度 {{ friend.quota }}</span>
              </div>
              <span class="sweet-friend__price">
                {{ friend.price }}<small>/个</small>
                <em class="sweet-status" :class="friend.better ? 'is-done' : 'is-idle'">{{ friend.delta > 0 ? `+${friend.delta}` : friend.delta }}</em>
              </span>
            </article>
          </div>
          <p v-else-if="!friendListLoading && !friendRestricted" class="sweet-panel__meta">好友列表里没有可读取的铺子，或活动尚未开始。</p>

          <div class="sweet-panel__row">
            <NInput v-model:value="friendGid" placeholder="好友 GID" size="small" class="sweet-gid" />
            <NInput v-model:value="friendToken" placeholder="粘贴好友分享卡片里的票据（UUID）" size="small" class="sweet-token" />
            <NButton size="small" :loading="friendLoading" @click="loadFriend">查询</NButton>
            <span v-if="friendShop" class="sweet-panel__meta">
              {{ friendShop.name || friendShop.gid }} · {{ friendShop.price }}/个 · 额度 {{ friendShop.quota }}
              · {{ friendShop.price > price ? `比我高 ${friendShop.price - price}` : friendShop.price < price ? `比我低 ${price - friendShop.price}` : '与我一致' }}
            </span>
          </div>
        </section>

        <!-- 自动化设置 -->
        <section class="sweet-card sweet-panel">
          <div class="sweet-panel__head">
            <h2>自动化设置</h2>
            <NButton size="tiny" :loading="saving" @click="saveSettings">保存</NButton>
          </div>
          <div class="sweet-form">
            <label class="sweet-form__row">
              <span>自动出售</span>
              <NSwitch v-model:value="settings.autoSell" size="small" />
            </label>
            <label class="sweet-form__row">
              <span>自动兑换</span>
              <NSwitch v-model:value="settings.autoExchange" size="small" />
            </label>
            <label class="sweet-form__row">
              <span>出售给最高价好友{{ friendRestricted ? '（官方受限，暂不生效）' : '' }}</span>
              <NSwitch v-model:value="settings.sellToBestFriend" size="small" :disabled="friendRestricted" />
            </label>
            <label class="sweet-form__row">
              <span>出售条件</span>
              <NSelect v-model:value="settings.priceTier" size="small" :options="tierOptions" class="sweet-select" />
            </label>
            <label class="sweet-form__row">
              <span>保留数量（留给兑换）</span>
              <NInputNumber v-model:value="settings.keepCount" :min="0" size="small" class="sweet-num" :show-button="false" />
            </label>
            <label class="sweet-form__row">
              <span>检查间隔（分钟）</span>
              <NInputNumber v-model:value="settings.checkIntervalMinutes" :min="1" :max="180" size="small" class="sweet-num" :show-button="false" />
            </label>
            <label class="sweet-form__row">
              <span>出售起始时间（HH:MM）</span>
              <NInput v-model:value="settings.sellAfterTime" placeholder="空 = 不限" size="small" class="sweet-num" />
            </label>
            <label class="sweet-form__row">
              <span>比价好友数</span>
              <NInputNumber v-model:value="settings.scanFriendLimit" :min="1" :max="60" size="small" class="sweet-num" :show-button="false" />
            </label>
            <label class="sweet-form__row">
              <span>比价缓存（分钟）</span>
              <NInputNumber v-model:value="settings.scanIntervalMinutes" :min="5" :max="720" size="small" class="sweet-num" :show-button="false" />
            </label>
          </div>
          <div class="sweet-panel__row">
            <NButton :loading="runLoading" @click="runOnce">立即执行一轮</NButton>
            <span class="sweet-panel__meta">开关关闭时只做只读判断，不会真的卖出或兑换</span>
          </div>
          <ol v-if="runResult && runResult.length" class="sweet-steps">
            <li v-for="(step, index) in runResult" :key="index">
              <template v-if="step.step === 'claim_seed'">
                领种子：{{ step.error ? step.error : (step.skipped === 'already_claimed' ? '今日已领' : `+${step.count}`) }}
              </template>
              <template v-else-if="step.step === 'claim_commission'">
                领提成：{{ step.error ? step.error : `+${step.amount}，余额 ${step.balance}` }}
              </template>
              <template v-else-if="step.step === 'share_crit'">
                分享暴击：{{ step.error ? step.error : (step.skipped === 'already_active' ? `加成 ${step.bonusPrice}` : `${step.beforePrice} → ${step.afterPrice}`) }}
              </template>
              <template v-else-if="step.step === 'sell'">
                出售：{{ step.count }} 个 × {{ step.targetPrice }}，收入 {{ step.totalGain }}{{ step.toFriend ? `（卖给 ${step.friendName || '好友'}）` : '' }}
              </template>
              <template v-else-if="step.step === 'sell_skipped'">
                出售跳过：{{ step.reason === 'no_inventory' ? `无库存（${step.owned}）` : step.reason === 'auto_sell_disabled' ? `自动出售未开启（库存 ${step.owned}）` : '等待暴击' }}
              </template>
              <template v-else-if="step.step === 'exchange'">
                兑换：{{ step.bought.length ? step.bought.map((one: any) => `${one.name}×${one.itemCount ?? 1}`).join('、') : '无需兑换' }}，余额 {{ step.balance }}
              </template>
              <template v-else-if="step.step === 'exchange_skipped'">
                兑换跳过：自动兑换未开启
              </template>
              <template v-else>
                {{ step.step }}
              </template>
            </li>
          </ol>
        </section>
      </template>

      <!-- 兑换商店 -->
      <template v-else-if="tab === 'exchange'">
        <section class="sweet-card sweet-bar">
          <div class="sweet-bar__value">
            <span>福气币余额</span>
            <strong>{{ (exchange?.balance ?? fortuneCoin).toLocaleString('zh-CN') }}<small>福气币</small></strong>
          </div>
          <div class="sweet-bar__progress">
            <span>售卖蜜薯获得福气币，按目录价格兑换限定奖励<em> · 每档每日限购</em></span>
          </div>
          <NButton quaternary circle :loading="exchangeLoading" title="刷新兑换商店" aria-label="刷新兑换商店" @click="loadExchange">
            <template #icon>
              <span class="i-carbon-renew" />
            </template>
          </NButton>
        </section>

        <p v-if="exchangeError" class="sweet-error" role="alert">
          <span class="i-carbon-warning-alt" aria-hidden="true" />{{ exchangeError }}
        </p>

        <div class="sweet-grid">
          <article
            v-for="item in exchange?.items || []"
            :key="item.index"
            class="sweet-card sweet-item"
            :class="{ 'is-done': item.remaining <= 0, 'is-ready': item.remaining > 0 && (exchange?.balance ?? 0) >= item.price }"
          >
            <span class="sweet-item__well">
              <img v-if="!brokenIcons[item.index]" :src="item.image || `/activity-center/sweet/${item.index}.png`" alt="" @error="brokenIcons[item.index] = true">
              <span v-else class="i-carbon-gift" aria-hidden="true" />
            </span>
            <div class="sweet-item__main">
              <strong>{{ item.name }}</strong>
              <span>{{ item.price.toLocaleString('zh-CN') }} 福气币 · 限购 <b>{{ item.bought }}/{{ item.limitTotal }}</b></span>
            </div>
            <NButton
              size="small"
              :type="item.remaining > 0 && (exchange?.balance ?? 0) >= item.price ? 'primary' : 'default'"
              :secondary="item.remaining <= 0 || (exchange?.balance ?? 0) < item.price"
              :disabled="item.remaining <= 0 || (exchange?.balance ?? 0) < item.price"
              :loading="buyingId === item.index"
              @click="buy(item)"
            >
              {{ item.remaining <= 0 ? '已兑完' : (exchange?.balance ?? 0) < item.price ? '福气币不足' : '兑换' }}
            </NButton>
          </article>
        </div>
      </template>
    </div>

    <NModal v-model:show="rulesOpen" preset="card" title="以薯换福 · 活动说明" class="sweet-rules" style="max-width: 640px">
      <ol class="sweet-rules__list">
        <li v-for="(rule, index) in RULES" :key="index">{{ rule }}</li>
      </ol>
    </NModal>
  </section>
</template>

<style scoped>
/* 结构与牧歌初启一致：标题行 → 页签 → 卡片流，直接铺在内容区。 */
.sweet {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding-bottom: 24px;
}

.sweet h1,
.sweet h2,
.sweet p {
  margin: 0;
}

.sweet-head {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-top: 16px;
}

.sweet-head__lead {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.sweet-head__icon {
  flex: none;
  border-radius: 8px;
  object-fit: cover;
}

.sweet-head__text {
  min-width: 0;
}

.sweet-head h1 {
  overflow: hidden;
  color: var(--ui-ink);
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sweet-head p {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 2px;
  color: var(--ui-muted);
  font-size: 12px;
  white-space: nowrap;
}

.sweet-head__badge {
  margin-left: 4px;
  padding: 0 7px;
  border-radius: 999px;
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
  font-weight: 600;
  line-height: 18px;
}

.sweet-head__badge.is-ended {
  color: var(--ui-muted);
  background: var(--ui-surface-soft);
}

.sweet-head__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.sweet-tabs {
  margin-top: 8px;
}

.sweet-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.sweet-tab__dot {
  position: absolute;
  top: -1px;
  right: -9px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--ui-danger);
}

.sweet-content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 14px;
  padding-top: 16px;
}

.sweet-error,
.sweet-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--ui-radius-control);
  font-size: 13px;
}

.sweet-error {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}

.sweet-notice {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}

.sweet-empty {
  display: flex;
  min-height: 220px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ui-muted);
  font-size: 13px;
}

.sweet-empty span {
  font-size: 28px;
}

.sweet-card {
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-card);
  background: var(--ui-surface);
  box-shadow:
    inset 0 1px 0 var(--glass-highlight),
    var(--ui-shadow-sm);
}

/* 汇总条：数值 | 进度 | 状态 */
.sweet-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 28px;
  padding: 16px 20px;
}

.sweet-bar__value {
  display: flex;
  flex: none;
  flex-direction: column;
}

.sweet-bar__value span {
  color: var(--ui-muted);
  font-size: 12px;
}

.sweet-bar__value strong {
  color: var(--ui-ink);
  font-size: 24px;
  font-weight: 700;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}

.sweet-bar__value small {
  margin-left: 4px;
  color: var(--ui-muted);
  font-size: 13px;
  font-weight: 500;
}

.sweet-bar__progress {
  display: flex;
  min-width: min(100%, 240px);
  flex: 1;
  flex-direction: column;
  gap: 8px;
  color: var(--ui-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.sweet-bar__progress em {
  color: var(--ui-subtle);
  font-style: normal;
}

.sweet-bar__progress b {
  color: var(--ui-ink);
  font-weight: 600;
}

.sweet-track {
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-surface-soft);
}

.sweet-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #f4c37a, #e8892f);
  transition: width 0.4s ease;
}

.sweet-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 296px), 1fr));
  align-items: start;
  gap: 12px;
}

.sweet-grid.is-small {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr));
}

.sweet-item {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  transition: border-color 0.15s ease, opacity 0.15s ease;
}

.sweet-item.is-compact {
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 10px;
  padding: 10px 12px;
}

.sweet-item.is-ready {
  border-color: color-mix(in srgb, var(--ui-primary) 45%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary-soft) 60%, var(--ui-surface));
}

.sweet-item.is-done,
.sweet-item.is-idle {
  opacity: 0.62;
}

.sweet-item__well {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 12px;
  background: var(--ui-surface-soft);
  font-size: 20px;
  color: var(--ui-muted);
}

.sweet-item.is-compact .sweet-item__well {
  width: 40px;
  height: 40px;
  border-radius: 10px;
}

.sweet-item__well img {
  width: 76%;
  height: 76%;
  object-fit: contain;
}

.sweet-item__main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.sweet-item__main strong {
  overflow: hidden;
  color: var(--ui-ink);
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sweet-item__main span {
  overflow: hidden;
  color: var(--ui-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sweet-item__main b {
  color: var(--ui-ink);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.sweet-status {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  color: var(--ui-subtle);
  font-size: 12px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.sweet-status.is-done {
  color: var(--ui-primary);
  font-weight: 600;
}

.sweet-status.is-idle {
  color: var(--ui-muted);
}

/* 操作面板：出售 / 比价 / 设置 */
.sweet-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px;
}

.sweet-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.sweet-panel__head h2 {
  color: var(--ui-ink);
  font-size: 15px;
  font-weight: 650;
}

.sweet-panel__hint,
.sweet-panel__meta {
  color: var(--ui-muted);
  font-size: 12px;
}

.sweet-panel__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.sweet-panel__warn {
  color: var(--ui-warning);
  font-size: 12px;
}

.sweet-num {
  width: 104px;
}

.sweet-gid {
  width: 160px;
}

.sweet-token {
  width: 320px;
}

.sweet-select {
  width: 220px;
}

.sweet-friend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: var(--ui-radius-control);
  background: var(--ui-surface-soft);
}

.sweet-friend__name {
  color: var(--ui-ink);
  font-size: 13px;
  font-weight: 600;
}

.sweet-friend__price {
  color: var(--ui-ink);
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.sweet-friend__price small {
  margin-left: 2px;
  color: var(--ui-muted);
  font-size: 12px;
  font-weight: 500;
}

.sweet-friend__price em {
  margin-left: 6px;
  font-style: normal;
}

.sweet-form {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  gap: 10px 20px;
}

.sweet-form__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--ui-ink);
  font-size: 13px;
}

.sweet-steps {
  margin: 0;
  padding-left: 18px;
  color: var(--ui-muted);
  font-size: 12px;
  line-height: 1.7;
}

.sweet-rules__list {
  margin: 0;
  padding-left: 20px;
  list-style: decimal;
  color: var(--ui-ink);
  font-size: 13px;
  line-height: 1.7;
}

.sweet-rules__list li + li {
  margin-top: 8px;
}
</style>