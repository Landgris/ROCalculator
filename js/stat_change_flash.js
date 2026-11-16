/*
 * 數值變動閃爍提示：裝備編輯按確認、載入已存裝備、或切換裝備效果勾選框時，
 * 「一般」面板（#general-panel）裡受影響的數值閃綠（變好）／閃紅（變差）。
 *
 * 做法：不在模板裡每個數值 span 各自加標記，而是
 *   1. 觸發當下（Vue 還沒重新渲染，畫面上仍是舊值）掃一次面板裡所有「葉節點」元素，記下數字；
 *   2. 用 MutationObserver 觀察面板，畫面停止變動 SETTLE_MS 後比對，數字有變的那一整列（.statusbox）閃一下；
 *   3. 觀察 WATCH_MS 毫秒後自動停止。
 *
 * 好壞方向：計算機的慣例是「詞條數值越大越好」——連 opersymbol 為 '-' 的詞條（後延、詠唱、
 * 屬性耐性減少…）也是存正數代表「減少得越多」，所以面板上大部分數字都是變大＝變好。
 * 例外是面板顯示時刻意轉成負數的值（onOption 裡 -Math.abs(...) 的 CD/GCD 等）：數字越負越好，
 * 這種 span 在模板上標 data-better="lower"，這裡會反轉方向。
 * 所以不是直接看 opersymbol（例如「屬性耐性減少」是 '-'，但面板顯示正數、變大才是變好），
 * 而是看「面板上這個數字」本身的方向。
 *
 * 文字裡有多個數字時（例如「100 + 50」）以第一個不同的數字決定方向；
 * 父元素去掉數字後的文字（標籤）不同時不閃，避免 v-for 重用 DOM 時拿不相關的數字比較。
 */
(function (global) {
    'use strict';

    var WATCH_MS = 1500;
    var SETTLE_MS = 150;
    var FLASH_MS = 4100; // 動畫本身 4s（見 css .stat-flash-up/.stat-flash-down::after），多留一點再移除 class
    var MAX_TEXT_LEN = 60;
    var DEFAULT_ROOT_ID = 'general-panel';

    var active = null; // { root, snapshot: Map<Element, {nums, sig}>, observer, settleTimer, stopTimer }

    function parseNumbers(text) {
        if (!text) return null;
        // 模板換行會在文字中間留一大串空白（例如「190 ~\n        190」），先壓成單一空白再判斷長度
        text = text.replace(/\s+/g, ' ');
        if (text.length > MAX_TEXT_LEN) return null;
        var cleaned = text.replace(/(\d),(?=\d{3})/g, '$1');
        var m = cleaned.match(/-?\d+(?:\.\d+)?/g);
        return m ? m.map(Number) : null;
    }

    // 元素的「標籤」簽章＝所在列（.statusbox）第一欄的標籤文字＋元素自己去掉數字後的文字
    // （例如明細列「風 10%」→「風%」）。v-for 重用 DOM 讓同一個 span 改顯示別的項目時簽章會不同，
    // 就只更新快照、不閃。刻意不用整個父元素的文字：數值旁邊的「(1)」來源摘要會隨數值出現/消失，
    // 用父元素文字會讓 0 → 50 這種第一次加上來源的變化被誤判成「換了項目」而不閃。
    function stripNums(text) {
        return (text || '').replace(/-?\d[\d,]*(?:\.\d+)?/g, '').replace(/\s+/g, '');
    }
    function signature(el) {
        var row = el.closest('.statusbox');
        var label = row && row.firstElementChild && !row.firstElementChild.contains(el)
            ? row.firstElementChild.textContent : '';
        return (stripNums(label) + '|' + stripNums(el.textContent)).slice(0, 200);
    }

    function collect(root) {
        var map = new Map();
        var all = root.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
            var el = all[i];
            if (el.children.length > 0) continue;
            var nums = parseNumbers(el.textContent);
            if (!nums) continue;
            map.set(el, { nums: nums, sig: signature(el) });
        }
        return map;
    }

    // 回傳 1（數字變大）/ -1（變小）/ 0（沒變或無法比較）
    function direction(oldNums, newNums) {
        var n = Math.min(oldNums.length, newNums.length);
        for (var i = 0; i < n; i++) {
            if (newNums[i] > oldNums[i]) return 1;
            if (newNums[i] < oldNums[i]) return -1;
        }
        return 0;
    }

    function flash(el, better) {
        var cls = better ? 'stat-flash-up' : 'stat-flash-down';
        el.classList.remove('stat-flash-up', 'stat-flash-down');
        void el.offsetWidth; // 強制 reflow，連續觸發也能重播動畫
        el.classList.add(cls);
        clearTimeout(el._statFlashTimer);
        el._statFlashTimer = setTimeout(function () {
            el.classList.remove('stat-flash-up', 'stat-flash-down');
        }, FLASH_MS);
    }

    function compare() {
        if (!active) return;
        var flashedRows = new Set(); // 同一列有好幾個數字變動時，這一輪只閃一次（以第一個為準）
        active.snapshot.forEach(function (old, el) {
            if (!el.isConnected) { active.snapshot.delete(el); return; }
            var newNums = parseNumbers(el.textContent);
            if (!newNums) return;
            var dir = direction(old.nums, newNums);
            if (dir === 0) return;
            var sig = signature(el);
            if (sig === old.sig) {
                // 閃整列（.statusbox），不是只閃數字本身
                var row = el.closest('.statusbox') || el;
                if (!flashedRows.has(row)) {
                    flashedRows.add(row);
                    var lowerBetter = !!el.closest('[data-better="lower"]');
                    flash(row, lowerBetter ? dir < 0 : dir > 0);
                }
            }
            active.snapshot.set(el, { nums: newNums, sig: sig });
        });
    }

    function stop() {
        if (!active) return;
        compare();
        active.observer.disconnect();
        clearTimeout(active.settleTimer);
        clearTimeout(active.stopTimer);
        active = null;
    }

    // 必須在畫面重新渲染「之前」呼叫（同一個事件處理函式裡、改資料前後都可以，
    // 因為 Vue 會等到下一個 tick 才更新 DOM）。
    function begin(root) {
        root = root || document.getElementById(DEFAULT_ROOT_ID);
        if (active) stop();
        // 面板不存在或被收合（v-show → display:none）時完全不做事
        if (!root || root.offsetParent === null) return;
        var state = {
            root: root,
            snapshot: collect(root),
            observer: null,
            settleTimer: null,
            stopTimer: null,
        };
        state.observer = new MutationObserver(function () {
            clearTimeout(state.settleTimer);
            state.settleTimer = setTimeout(compare, SETTLE_MS);
        });
        state.observer.observe(root, { subtree: true, childList: true, characterData: true });
        state.stopTimer = setTimeout(stop, WATCH_MS);
        active = state;
    }

    global.StatChangeFlash = { begin: begin, stop: stop };
})(typeof window !== 'undefined' ? window : this);
