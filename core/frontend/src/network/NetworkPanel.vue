<script setup lang="ts">
import { computed, ref } from 'vue';
import NetworkAddress from './NetworkAddress.vue';
import { connectionRows, validQr, validity, addressTexts, type NetworkActions, type NetworkState, type NetworkDraft, type NetworkFields } from './settings';
const props = defineProps<{ state: NetworkState; actions: NetworkActions; copy(value: string): Promise<unknown> }>();
const password = ref<HTMLInputElement | null>(null), root = ref<HTMLElement | null>(null);
const unavailable = computed(() => props.state.loading || props.state.saving || !props.state.settings || props.state.settings.canManage === false);
const rows = computed(() => connectionRows(props.state.settings));
function readFields(): NetworkFields {
  const get = (name: string) => root.value!.querySelector<HTMLInputElement>(`#network-settings-${name}`)!;
  return { enabled: get('enabled').checked, publicEnabled: get('public-enabled').checked, publicUrl: get('public-url').value, port: get('port').value,
    httpsEnabled: get('https-enabled').checked, httpsPort: get('https-port').value };
}
function readDraft(): NetworkDraft { return { ...readFields(), password: password.value?.value || '' }; }
function edit() { props.actions.edit(readFields()); }
defineExpose({ readDraft, readFields, clearPassword() { if (password.value) password.value.value = ''; }, focus(target: string) { root.value?.querySelector<HTMLInputElement>(`#network-settings-${target}`)?.focus(); } });
</script>
<template>
  <div ref="root">

      <p id="network-settings-status" class="network-settings-hint" role="status" :textContent="state.status"></p>
      <div id="network-settings-fields" :hidden="state.loading || !state.settings || state.settings.canManage === false">
        <label class="network-settings-switch"><span>局域网连接<small>同一网络的手机、平板可以连接</small></span><input
            id="network-settings-enabled" type="checkbox" role="switch" aria-label="局域网连接" :checked="state.fields.enabled" :disabled="unavailable" @change="edit"></label>
        <label class="network-settings-switch"><span>外网连接<small>公网 IPv6、端口映射和 Tailscale</small></span><input
            id="network-settings-public-enabled" type="checkbox" role="switch" aria-label="外网连接" :checked="state.fields.publicEnabled" :disabled="unavailable || typeof state.settings?.publicEnabled !== 'boolean'" @change="edit"></label>
        <div class="network-settings-inputs"><label>连接端口<input id="network-settings-port" type="number" min="1024"
              max="65535" step="1" required inputmode="numeric" :value="state.fields.port" :disabled="unavailable" @input="edit"></label><label>连接密码<input
              id="network-settings-password" type="password" maxlength="256" autocomplete="new-password"
              placeholder="至少 8 个字符" ref="password" :disabled="unavailable" :required="(state.fields.enabled || state.fields.publicEnabled) && !state.settings?.passwordConfigured"></label></div>
        <p id="network-settings-password-hint" class="network-settings-hint" :textContent="state.settings?.passwordConfigured ? '所有连接共用这个密码。留空保留原密码，填写新密码即可修改。' : '所有连接共用这个密码。首次开启时请设置 8–256 个字符的密码。'"></p>
        <section class="network-connections" aria-labelledby="network-settings-connections-title">
          <header><h4 id="network-settings-connections-title">连接地址</h4><button id="network-settings-refresh" type="button"
              class="network-connections-refresh" :disabled="unavailable || state.refreshing" :textContent="state.refreshing ? '正在刷新…' : '刷新'" @click="actions.refresh"></button></header>
          <ul>
          <li class="network-connection" id="network-settings-row-lan"><svg class="network-connection-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 9.5a11 11 0 0 1 15 0M7.5 12.8a6.6 6.6 0 0 1 9 0M10.5 16a2.2 2.2 0 0 1 3 0"/><circle cx="12" cy="18.6" r=".9"/></svg><div class="network-connection-body"><strong>局域网</strong><div id="network-settings-lan-urls" class="network-connection-urls"><NetworkAddress v-for="(url, index) in rows.lan.urls" :key="url + index" :url="url" :copy="copy" /></div><small id="network-settings-lan-note" :class="{ 'is-muted': rows.lan.muted }">{{ rows.lan.note }}</small></div></li>
          <li class="network-connection" id="network-settings-row-ipv6"><svg class="network-connection-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.4 2.3 3.6 5 3.6 8s-1.2 5.7-3.6 8c-2.4-2.3-3.6-5-3.6-8S9.6 6.3 12 4z"/></svg><div class="network-connection-body"><strong>公网 IPv6</strong><div id="network-settings-ipv6-urls" class="network-connection-urls"><NetworkAddress v-for="(url, index) in rows.ipv6.urls" :key="url + index" :url="url" :copy="copy" /></div><small id="network-settings-ipv6-note" :class="{ 'is-muted': rows.ipv6.muted }">{{ rows.ipv6.note }}</small></div></li>
          <li class="network-connection" id="network-settings-row-custom"><svg class="network-connection-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="6" r="2.2"/><circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M12 8.2v4M12 12.2 7.3 16.2M12 12.2l4.7 4"/></svg><div class="network-connection-body"><strong>公网 IPv4 / 自定义地址</strong><input id="network-settings-public-url" type="url" maxlength="500" placeholder="选填，如 http://quiz.example.com:8788/" autocomplete="url" aria-label="自定义外网地址" :value="state.fields.publicUrl" :disabled="unavailable || typeof state.settings?.publicEnabled !== 'boolean'" @input="edit"><div id="network-settings-custom-urls" class="network-connection-urls"><NetworkAddress v-for="(url, index) in rows.custom.urls" :key="url + index" :url="url" :copy="copy" /></div><small id="network-settings-custom-note" :class="{ 'is-muted': rows.custom.muted }">{{ rows.custom.note }}</small></div></li>
          <li class="network-connection" id="network-settings-row-tailscale"><svg class="network-connection-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.8 18.5 6v5.3c0 4.1-2.7 7.4-6.5 8.9-3.8-1.5-6.5-4.8-6.5-8.9V6z"/></svg><div class="network-connection-body"><strong>Tailscale</strong><div id="network-settings-tailscale-urls" class="network-connection-urls"><NetworkAddress v-for="(url, index) in rows.tailscale.urls" :key="url + index" :url="url" :copy="copy" /></div><small id="network-settings-tailscale-note" :class="{ 'is-muted': rows.tailscale.muted }">{{ rows.tailscale.note }}</small></div></li>
          </ul>
        </section>
        <details class="network-settings-advanced">
          <summary>局域网 HTTPS（备用）</summary>
          <section id="network-settings-https" class="network-settings-https" :hidden="!state.settings?.https || state.settings.canManage === false">
            <label class="network-settings-switch"><span>开启局域网 HTTPS<small>需先开启局域网连接，使用同一连接密码；手机要安装一次本机根证书。</small></span><input
                id="network-settings-https-enabled" type="checkbox" role="switch" aria-label="局域网 HTTPS" :checked="state.fields.httpsEnabled" :disabled="unavailable || !state.fields.enabled" @change="edit"></label>
            <label class="network-settings-https-port">HTTPS 端口<input id="network-settings-https-port" type="number" min="1024"
                max="65535" step="1" inputmode="numeric" :value="state.fields.httpsPort" :disabled="unavailable" @input="edit"></label>
            <p id="network-settings-https-status" class="network-settings-hint" role="status" :textContent="state.httpsStatus"></p>
            <div id="network-settings-https-details" :hidden="!state.settings?.https?.enabled">
              <div class="network-settings-https-codes">
                <figure><img id="network-settings-https-certificate-qr" alt="下载根证书的二维码" width="152" height="152"
                    :hidden="!validQr(state.settings?.https?.certificateQr)" :src="validQr(state.settings?.https?.certificateQr) ? state.settings?.https?.certificateQr : undefined"><figcaption>① 扫码下载根证书</figcaption></figure>
                <figure><img id="network-settings-https-url-qr" alt="打开 HTTPS 地址的二维码" width="152" height="152"
                    :hidden="!validQr(state.settings?.https?.urlQr)" :src="validQr(state.settings?.https?.urlQr) ? state.settings?.https?.urlQr : undefined"><figcaption>② 安装并信任后扫码打开</figcaption></figure>
              </div>
              <section class="network-settings-addresses">
                <h4>根证书下载地址（HTTP，只提供公钥证书）</h4>
                <div id="network-settings-https-certificate-urls"><code v-for="(url, index) in addressTexts(state.settings?.https?.certificateUrls)" :key="index">{{ url }}</code></div>
                <h4 class="network-settings-https-heading">HTTPS 连接地址</h4>
                <div id="network-settings-https-urls"><code v-for="(url, index) in addressTexts(state.settings?.https?.urls)" :key="index">{{ url }}</code></div>
                <h4 class="network-settings-https-heading">根证书 SHA-256 指纹</h4>
                <code id="network-settings-https-fingerprint" :textContent="typeof state.settings?.https?.fingerprint === 'string' ? state.settings.https.fingerprint : ''"></code>
                <p>安装前在手机的证书详情里核对指纹，完全一致再安装。</p>
                <p id="network-settings-https-validity" :textContent="validity(state.settings?.https)"></p>
              </section>
              <details class="network-settings-public-help network-settings-https-steps" open>
                <summary>手机安装步骤</summary>
                <ol>
                  <li><b>Android</b>：用 Chrome 扫码①下载证书，然后打开“设置 → 安全 → 加密与凭据 → 安装证书 → CA 证书”，选中下载的
                    QuizForge-LAN-CA.crt。不同品牌菜单名称略有差异，可在设置里搜索“CA 证书”。</li>
                  <li><b>iPhone / iPad</b>：用相机扫码①，在 Safari 中允许下载描述文件；到“设置 → 已下载描述文件”安装；再到“设置 → 通用 → 关于本机 →
                    证书信任设置”，为 QuizForge LAN Root CA 开启完全信任。</li>
                  <li>扫码②或手动打开 HTTPS 地址，输入连接密码。</li>
                </ol>
              </details>
              <p class="network-settings-https-warning">根证书只装在你自己的设备上，不要发给别人。根证书私钥只保存在这台电脑的数据目录，任何地址都不会提供私钥。关闭局域网 HTTPS 会停止 HTTPS
                端口；证书保留，再次开启无需重装。</p>
              <button id="network-settings-https-regenerate" type="button" class="network-settings-https-regenerate" :disabled="unavailable || !state.settings?.https?.enabled" @click="actions.regenerate">重新生成根证书</button>
            </div>
          </section>
        </details>
        <p class="network-settings-firewall">此设置不会修改 Windows 防火墙。连接不上时，请允许 Node.js 的网络访问，或放行连接端口。</p>
      </div>
      <p id="network-settings-error" class="network-settings-error" role="alert" :hidden="!state.error" :textContent="state.error"></p>
      <div class="dialog-actions"><button id="network-settings-cancel" type="button" :disabled="state.saving" @click="actions.close">关闭</button><button
          id="network-settings-save" type="submit" :disabled="unavailable" :textContent="state.saving ? '正在保存…' : '保存设置'"></button></div>

  </div>
</template>
