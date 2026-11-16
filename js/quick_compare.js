/*
 * 快速比較（Quick Compare）：在傷害面板按「記錄」存下目前的傷害數字與配置快照，
 * 換裝／調素質後再記錄一筆，側邊面板用點線圖＋表格比較每一筆的差異。
 *
 * 這個檔案只放「純函式」：挑主指標、整理配置摘要、比對差異、畫 SVG。
 * 跟 Vue 狀態有關的（記錄、儲存、還原）在 index.html 的 onQuickCompare* methods。
 *
 * 記錄格式（localStorage 'StoreDB_QuickCompare'）：
 *   { id, time, name, changes:[字串], damageType, skillId, skillName, skillLevel, enemyName,
 *     primary:{ kind, avg, min, max }, dps, aspd, summary, snapshot }
 *   - summary：給差異比對用的精簡配置（素質、各欄位裝備名稱、精煉、消耗品…）
 *   - snapshot：buildAllSetSnapshot() 的完整配置，給「還原」用
 */
(function (global) {
    'use strict';

    var MAX_RECORDS = 20;
    var STATS = ['STR', 'AGI', 'VIT', 'INT', 'DEX', 'LUK', 'POW', 'STA', 'WIS', 'SPL', 'CON', 'CRT'];
    // 系列顏色（依技能分組），淺色／深色背景都看得清楚
    var COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#84cc16'];

    function num(v) { v = Number(v); return isFinite(v) ? v : 0; }

    /*
     * 挑主指標：有總傷就以總傷為主。
     *   kind: 'total'（多段總傷平均）/ 'single'（單次傷害平均）/ 'critexp'（暴擊技能：依暴擊率加權的期望值）
     * ctx = { damageType, ca: computeattribute, hit: EvalFormula(skill.hitnumber), critical, cri, aspd, skillId }
     */
    function pickMetrics(ctx) {
        var ca = ctx.ca || {};
        var multi = ctx.hit > 1 || ctx.hit < 0 || ctx.skillId === 'WL_CHAINLIGHTNING';
        var hasAspd = num(ctx.aspd) !== 0;
        var p = { kind: multi ? 'total' : 'single', avg: 0, min: 0, max: 0 };
        var dps = null;
        function range(min, max) { p.min = num(min); p.max = num(max); p.avg = (p.min + p.max) / 2; }

        switch (Number(ctx.damageType)) {
            case 0: { // 物理：SkillDamage_* 已含段數（單段時等於 atkc9）
                var hasTotal = num(ca.SkillDamage_max) > 0;
                if (hasTotal) range(ca.SkillDamage_min, ca.SkillDamage_max);
                else range(ca.atkc9_min, ca.atkc9_max);
                if (ctx.critical && num(ca.SkillDamageCRI_max) > 0) {
                    // 暴擊技能：非暴擊／暴擊依暴擊率加權，跟 ComputeATKDPS 同一套權重
                    var c = Math.max(0, Math.min(100, num(ctx.cri))) / 100;
                    var critAvg = (num(ca.SkillDamageCRI_min) + num(ca.SkillDamageCRI_max)) / 2;
                    p.kind = 'critexp';
                    p.avg = p.avg * (1 - c) + critAvg * c;
                    p.min = p.min * (1 - c) + num(ca.SkillDamageCRI_min) * c;
                    p.max = p.max * (1 - c) + num(ca.SkillDamageCRI_max) * c;
                }
                if (hasAspd) dps = num(ca.atkmulti_DPS);
                break;
            }
            case 1: // 魔法
            case 4: // 混傷（面板顯示的最終值同魔法欄位）
                if (multi) range(ca.matkmulti_min, ca.matkmulti_max);
                else range(ca.matk4_min, ca.matk4_max);
                if (hasAspd) dps = num(ca.matkmulti_DPS);
                break;
            case 2:
                range(ca.DragonBreathDMG, ca.DragonBreathDMG);
                p.kind = 'single';
                if (hasAspd) dps = num(ca.DragonBreathDMG_DPS);
                break;
            case 3:
                range(ca.TrapDMG_min, ca.TrapDMG_max);
                p.kind = 'single';
                break;
            case 5:
                range(ca.FalconDMG, ca.FalconDMG);
                p.kind = 'single';
                if (hasAspd) dps = num(ca.FalconDMG_DPS);
                break;
        }
        return { primary: p, dps: dps };
    }

    /*
     * 從目前配置整理出比對用的摘要。vm 是 Vue instance（用到它的 getter 取得翻譯後的名稱）。
     */
    function buildSummary(vm) {
        var st = vm.status || {};
        var stats = {};
        STATS.forEach(function (k) { stats[k] = num(st[k]); });
        var equip = (vm.equipspartlist || []).map(function (s) {
            return {
                id: s.id,
                label: vm.t(s.id, s.label),
                name: s.equipname || '',
                // 名稱沒變但效果被改（例如手動調數值）也要抓得到
                sig: hashStr(JSON.stringify(s.effectlist || [])),
            };
        });
        var consumables = (vm.consumablelist || []).filter(function (c) { return c.active; }).map(function (c) {
            var name = vm.getConsumableName ? vm.getConsumableName(c.id, c.name) : c.name;
            if (c.id == 14616 && c.ATKUP != null) name += '(' + c.ATKUP + ')';
            if (c.id == 14619 && c.MATKUP != null) name += '(' + c.MATKUP + ')';
            return name;
        });
        var supports = (vm.DefaultDB_SupportSkill || []).filter(function (it) { return it.skill && it.skill.active; }).map(function (it) {
            var s = it.skill;
            var name = vm.getSkillName ? vm.getSkillName(s.id) : (s.name || s.id);
            var args = [];
            if (s.argnum >= 1) args.push(s.arg1);
            if (s.argnum >= 2) args.push(s.arg2);
            return args.length ? name + '(' + args.join(',') + ')' : name;
        });
        var w = vm.weapon || {}, sw = vm.subweapon || {};
        var skill = vm.skill || {};
        var enemy = vm.enemyattribute || {};
        return {
            cls: st.classid || '',
            lv: num(st.Level), jlv: num(st.JOBLevel),
            stats: stats,
            equip: equip,
            weapon: { refine: num(w.refinelevel), grade: gradeText(w.grade) },
            subweapon: { refine: num(sw.refinelevel), grade: gradeText(sw.grade) },
            skill: { id: skill.id || '', name: skill.id && vm.getSkillName ? vm.getSkillName(skill.id) : (skill.name || ''), level: num(skill.level) },
            enemy: enemy.id != null && vm.getEnemyName ? vm.getEnemyName(enemy.id, enemy.name) : (enemy.name || ''),
            // 技能選項、輔助參數以外的其他選項（例如敵方抗性手動調整）不逐項列，只抓有沒有變
            enemySig: hashStr(JSON.stringify(enemy)),
            skillOptSig: hashStr(JSON.stringify(vm.skilloption || {})),
            consumables: consumables,
            supports: supports,
        };
    }

    function gradeText(g) {
        if (g == null || g === '') return '';
        if (typeof g === 'object') return String(g.label || g.id || '');
        return String(g);
    }

    function hashStr(s) {
        var h = 0;
        for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
        return h;
    }

    /*
     * 比對兩份摘要，回傳人看得懂的差異字串陣列（例如「STR 120→130」「頭上：A→B」「+天地樹祝福」）。
     * t(key, fallback) 用來翻譯少數固定字詞。
     */
    function diffSummary(a, b, t) {
        var out = [];
        if (!a || !b) return out;
        var dash = '—';
        if (a.cls !== b.cls) out.push(t('ui.compare.diff.class', '職業') + ' ' + (a.cls || dash) + '→' + (b.cls || dash));
        if (a.lv !== b.lv) out.push('Lv ' + a.lv + '→' + b.lv);
        if (a.jlv !== b.jlv) out.push('Job Lv ' + a.jlv + '→' + b.jlv);
        STATS.forEach(function (k) {
            var x = a.stats ? a.stats[k] : 0, y = b.stats ? b.stats[k] : 0;
            if (x !== y) out.push(k + ' ' + x + '→' + y);
        });
        if (a.skill.id !== b.skill.id) out.push(t('ui.compare.diff.skill', '技能') + ' ' + (a.skill.name || dash) + '→' + (b.skill.name || dash));
        else if (a.skill.level !== b.skill.level) out.push(b.skill.name + ' Lv' + a.skill.level + '→' + b.skill.level);
        var refineLabel = t('ui.compare.diff.refine', '精煉');
        if (a.weapon.refine !== b.weapon.refine) out.push(t('weaponr', '主手') + refineLabel + ' +' + a.weapon.refine + '→+' + b.weapon.refine);
        if (a.weapon.grade !== b.weapon.grade) out.push(t('weaponr', '主手') + ' ' + (a.weapon.grade || dash) + '→' + (b.weapon.grade || dash));
        if (a.subweapon.refine !== b.subweapon.refine) out.push(t('weaponl', '副手') + refineLabel + ' +' + a.subweapon.refine + '→+' + b.subweapon.refine);
        if (a.subweapon.grade !== b.subweapon.grade) out.push(t('weaponl', '副手') + ' ' + (a.subweapon.grade || dash) + '→' + (b.subweapon.grade || dash));

        var aEq = {};
        (a.equip || []).forEach(function (e) { aEq[e.id] = e; });
        (b.equip || []).forEach(function (e) {
            var o = aEq[e.id];
            if (!o) return;
            if (o.name !== e.name) out.push(e.label + '：' + (o.name || dash) + '→' + (e.name || dash));
            else if (o.sig !== e.sig) out.push(e.label + (e.name ? '「' + e.name + '」' : '') + t('ui.compare.diff.effectchanged', '效果變更'));
        });

        listDiff(a.consumables, b.consumables, out);
        listDiff(a.supports, b.supports, out);

        if (a.enemy !== b.enemy) out.push(t('ui.compare.diff.enemy', '敵人') + ' ' + (a.enemy || dash) + '→' + (b.enemy || dash));
        else if (a.enemySig !== b.enemySig) out.push(t('ui.compare.diff.enemychanged', '敵人設定變更'));
        if (a.skill.id === b.skill.id && a.skillOptSig !== b.skillOptSig) out.push(t('ui.compare.diff.skilloption', '技能選項變更'));
        return out;
    }

    function listDiff(a, b, out) {
        a = a || []; b = b || [];
        b.forEach(function (x) { if (a.indexOf(x) < 0) out.push('+' + x); });
        a.forEach(function (x) { if (b.indexOf(x) < 0) out.push('−' + x); });
    }

    /*
     * 依技能分組成系列，並算出每筆相對「同系列基準」的差異百分比。
     * 基準：該系列中被釘選的那筆（baselineIds[skillKey]），沒有就用該系列第一筆。
     * 回傳 { series:[{ key, name, color, baselineId }], rows:[{ rec, seriesIdx, dPrimary, dDps, enemyMismatch, isBaseline }] }
     */
    function analyze(records, baselineIds) {
        baselineIds = baselineIds || {};
        var series = [], byKey = {};
        records.forEach(function (r) {
            var key = seriesKey(r);
            if (!byKey[key]) {
                byKey[key] = { key: key, name: r.skillName || key, color: COLORS[series.length % COLORS.length], baselineId: null, records: [] };
                series.push(byKey[key]);
            }
            byKey[key].records.push(r);
        });
        series.forEach(function (s) {
            var pinned = baselineIds[s.key];
            var hit = pinned && s.records.some(function (r) { return r.id === pinned; });
            s.baselineId = hit ? pinned : s.records[0].id;
        });
        var rows = records.map(function (r) {
            var s = byKey[seriesKey(r)];
            var base = s.records.filter(function (x) { return x.id === s.baselineId; })[0];
            return {
                rec: r,
                seriesIdx: series.indexOf(s),
                color: s.color,
                isBaseline: r.id === s.baselineId,
                dPrimary: pct(r.primary && r.primary.avg, base.primary && base.primary.avg),
                dDps: pct(r.dps, base.dps),
                enemyMismatch: r.enemyName !== base.enemyName,
            };
        });
        return { series: series, rows: rows };
    }

    function seriesKey(r) { return r.skillId || r.skillName || '?'; }

    function pct(v, base) {
        if (v == null || base == null || !base) return null;
        return (v - base) / base * 100;
    }

    // 1234567 → 1.23M，給座標軸用
    function shortNum(v) {
        var a = Math.abs(v);
        if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 1 : 2) + 'B';
        if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 1 : 2) + 'M';
        if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
        return String(Math.round(v));
    }

    function fmt(v) { return Math.round(v).toLocaleString('en-US'); }
    function fmtPct(p) { return p == null ? '' : (p >= 0 ? '+' : '') + p.toFixed(1) + '%'; }
    function esc(s) {
        return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    }

    /*
     * 畫點線圖，回傳 SVG 字串（v-html 用）。
     * metric: 'primary' | 'dps'；highlightId：目前滑過表格的那筆，畫大一點。
     * 每個點是 <g class="qc-pt" data-id>，點擊時由外部用 data-id 找到對應記錄。
     */
    function renderChart(analysis, metric, opts) {
        opts = opts || {};
        var W = 460, H = 230, L = 56, R = 14, T = 14, B = 30;
        var rows = analysis.rows;
        var n = rows.length;
        var val = function (row) {
            if (metric === 'dps') return row.rec.dps == null ? null : row.rec.dps;
            return row.rec.primary ? row.rec.primary.avg : null;
        };
        var vals = rows.map(val).filter(function (v) { return v != null; });
        if (!vals.length) {
            return '<svg class="qc-chart" viewBox="0 0 ' + W + ' ' + H + '"><text class="qc-empty" x="' + (W / 2) + '" y="' + (H / 2) + '" text-anchor="middle">' +
                esc(opts.emptyText || '') + '</text></svg>';
        }
        var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
        // 差異通常只有幾 %，Y 軸不從 0 開始，否則線會擠成一條水平線
        var span = hi - lo;
        if (span === 0) span = Math.abs(hi) * 0.1 || 1;
        lo -= span * 0.15; hi += span * 0.15;
        if (lo < 0 && Math.min.apply(null, vals) >= 0) lo = 0;
        var x = function (i) { return n === 1 ? (L + (W - L - R) / 2) : L + (W - L - R) * i / (n - 1); };
        var y = function (v) { return T + (H - T - B) * (1 - (v - lo) / (hi - lo)); };

        var s = [];
        s.push('<svg class="qc-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">');
        // 格線 + Y 軸刻度
        for (var g = 0; g <= 4; g++) {
            var gv = lo + (hi - lo) * g / 4, gy = y(gv);
            s.push('<line class="qc-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>');
            s.push('<text class="qc-axis" x="' + (L - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + shortNum(gv) + '</text>');
        }
        // X 軸標籤（筆數多時隔幾筆標一次）
        var step = Math.ceil(n / 10);
        rows.forEach(function (row, i) {
            if (i % step !== 0 && i !== n - 1) return;
            s.push('<text class="qc-axis" x="' + x(i) + '" y="' + (H - B + 18) + '" text-anchor="middle">#' + row.rec.seq + '</text>');
        });
        // 只有一個系列時畫基準線
        if (analysis.series.length === 1) {
            var baseRow = rows.filter(function (r) { return r.isBaseline; })[0];
            var bv = baseRow && val(baseRow);
            if (bv != null) {
                s.push('<line class="qc-baseline" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(bv) + '" y2="' + y(bv) + '"/>');
            }
        }
        // 每個系列一條線（同技能的記錄依序連起來）
        analysis.series.forEach(function (ser, si) {
            var pts = [];
            rows.forEach(function (row, i) {
                var v = val(row);
                if (row.seriesIdx === si && v != null) pts.push(x(i).toFixed(1) + ',' + y(v).toFixed(1));
            });
            if (pts.length > 1) s.push('<polyline class="qc-line" stroke="' + ser.color + '" points="' + pts.join(' ') + '"/>');
        });
        // 點
        rows.forEach(function (row, i) {
            var v = val(row);
            if (v == null) return;
            var d = metric === 'dps' ? row.dDps : row.dPrimary;
            var tip = '#' + row.rec.seq + (row.rec.name ? ' ' + row.rec.name : '') + '\n' + row.rec.skillName + '\n' +
                fmt(v) + (row.isBaseline ? '  (' + (opts.baselineText || 'baseline') + ')' : (d != null ? '  (' + fmtPct(d) + ')' : ''));
            var hl = opts.highlightId === row.rec.id;
            var r = hl ? 6.5 : (row.isBaseline ? 5.5 : 4.5);
            var hollow = row.enemyMismatch;
            s.push('<g class="qc-pt' + (hl ? ' is-hl' : '') + '" data-id="' + esc(row.rec.id) + '"><title>' + esc(tip) + '</title>' +
                '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="12" fill="transparent"/>' +
                '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + r + '" stroke="' + row.color + '" stroke-width="2" fill="' + (hollow ? 'var(--dialog-bg)' : row.color) + '"/>' +
                (row.isBaseline ? '<circle cx="' + x(i) + '" cy="' + y(v) + '" r="' + (r + 3) + '" stroke="' + row.color + '" stroke-width="1" fill="none"/>' : '') +
                '</g>');
        });
        s.push('</svg>');
        return s.join('');
    }

    global.QuickCompare = {
        MAX_RECORDS: MAX_RECORDS,
        pickMetrics: pickMetrics,
        buildSummary: buildSummary,
        diffSummary: diffSummary,
        analyze: analyze,
        renderChart: renderChart,
        fmtPct: fmtPct,
    };
})(window);
