/*
 * 技能樹資料載入/正規化。
 *
 * 執行期直接 fetch data/grf/zero/*.lua（Big5 編碼）用 lua_table_parser.js
 * 解析，不做離線轉檔——官方改版增加技能時，直接覆蓋這幾個 lua 檔重新整理
 * 頁面即可生效。
 *
 * 對外只提供這份 SkillTreeData 物件；技能樹 dialog（skill_tree_view.js）
 * 透過它拿資料，不直接碰 lua_table_parser。
 */
(function (global) {
    'use strict';

    var COLS_PER_ROW = 7;
    var COLOR_CODE_RE = /\^[0-9A-Fa-f]{6}/g;

    // 等級從 1 開始（Lv1 不用花點數），所以能實際花的點數 = 該轉職最高等級 - 1。
    // 下面兩份表先照「最高等級」寫，再統一用這個函式轉成「可花點數」，這樣之後
    // 對照官方等級表修正數字時，直接改最高等級就好，不用每次手動再減 1。
    function levelToPoints(map) {
        var out = {};
        Object.keys(map).forEach(function (k) { out[k] = map[k] - 1; });
        return out;
    }

    // ==================== Zero 資料來源 ====================
    // 每個 JOBID 頁的「最高等級」（見 docs/SKILLTREE_DIALOG_PLAN.md 第三節）
    var ZERO_MAX_LEVEL = {
        JT_SWORDMAN: 50, JT_MAGICIAN: 50, JT_ARCHER: 50, JT_ACOLYTE: 50, JT_MERCHANT: 50, JT_THIEF: 50,
        JT_KNIGHT: 70, JT_PRIEST: 70, JT_WIZARD: 70, JT_BLACKSMITH: 70, JT_HUNTER: 70, JT_ASSASSIN: 70,
        JT_CRUSADER: 70, JT_MONK: 70, JT_SAGE: 70, JT_ROGUE: 70, JT_ALCHEMIST: 70, JT_BARD: 70, JT_DANCER: 70,
        JT_REBELLION: 70, JT_KAGEROU: 70, JT_OBORO: 70, JT_NINJA: 70, JT_GUNSLINGER: 70,
        JT_SUPERNOVICE: 99, JT_SUPERNOVICE2: 70
    };
    var ZERO_POINT_CAP = levelToPoints(ZERO_MAX_LEVEL);

    // 1轉頁 -> 2轉頁 -> 計算機 classes.json 的最終職業代碼。
    // 已用 classes.json 實際的 label（如 RK="騎士/盧恩騎士/盧恩龍爵"）核對過，
    // 見 docs/SKILLTREE_DIALOG_PLAN.md 第二節。
    // SE/SL/SUM/DR 是太極/召喚師/特殊職系，Zero 資料沒有對應內容，不列入。
    var ZERO_LINEAGE = [
        { finalClass: 'RK', stages: ['JT_SWORDMAN', 'JT_KNIGHT'] },
        { finalClass: 'RG', stages: ['JT_SWORDMAN', 'JT_CRUSADER'] },
        { finalClass: 'WL', stages: ['JT_MAGICIAN', 'JT_WIZARD'] },
        { finalClass: 'SO', stages: ['JT_MAGICIAN', 'JT_SAGE'] },
        { finalClass: 'RA', stages: ['JT_ARCHER', 'JT_HUNTER'] },
        { finalClass: 'MI', stages: ['JT_ARCHER', 'JT_BARD'] },
        { finalClass: 'WA', stages: ['JT_ARCHER', 'JT_DANCER'] },
        { finalClass: 'AB', stages: ['JT_ACOLYTE', 'JT_PRIEST'] },
        { finalClass: 'SU', stages: ['JT_ACOLYTE', 'JT_MONK'] },
        { finalClass: 'ME', stages: ['JT_MERCHANT', 'JT_BLACKSMITH'] },
        { finalClass: 'GE', stages: ['JT_MERCHANT', 'JT_ALCHEMIST'] },
        { finalClass: 'GX', stages: ['JT_THIEF', 'JT_ASSASSIN'] },
        { finalClass: 'SC', stages: ['JT_THIEF', 'JT_ROGUE'] },
        { finalClass: 'RE', stages: ['JT_GUNSLINGER', 'JT_REBELLION'] },
        { finalClass: 'KO', stages: ['JT_NINJA', 'JT_KAGEROU'] },
        { finalClass: 'OB', stages: ['JT_NINJA', 'JT_OBORO'] },
        { finalClass: 'SN', stages: ['JT_SUPERNOVICE', 'JT_SUPERNOVICE2'] }
    ];

    // ==================== 標準版（轉職制/含三轉四轉）資料來源 ====================
    // 以下數字是「該轉職最高等級」（使用者確認）：1轉/2轉(非轉生) 50，3轉 70，4轉 60；
    // 忍者/格鬥槍手系 70/70/60；拳聖系、悟靈系 50/50/70/60（跟六大職業同一套數字）；
    // 召喚師系（魂靈師）只有 60/60。轉生二轉（_H 結尾那些頁）不使用、不列入 lineage。
    // 太極系（使用者確認）：JT_TAEKWON=50，之後不管選拳聖線還是悟靈線，第二頁都是50
    // （JT_STAR=50、JT_LINKER=50），之後拳聖線的 JT_STAR_EMPEROR 沿用60（沒有第三頁可用70）。
    // 實際可花的技能點 = 最高等級 - 1（Lv1 不用花點），由下面 levelToPoints() 統一轉換。
    var STANDARD_MAX_LEVEL = {
        // 六大職業：1轉/2轉 50，3轉 70，4轉 60
        JT_SWORDMAN: 50, JT_MAGICIAN: 50, JT_ARCHER: 50, JT_ACOLYTE: 50, JT_MERCHANT: 50, JT_THIEF: 50,
        JT_KNIGHT: 50, JT_CRUSADER: 50, JT_WIZARD: 50, JT_SAGE: 50, JT_HUNTER: 50, JT_BARD: 50, JT_DANCER: 50,
        JT_PRIEST: 50, JT_MONK: 50, JT_BLACKSMITH: 50, JT_ALCHEMIST: 50, JT_ASSASSIN: 50, JT_ROGUE: 50,
        JT_RUNE_KNIGHT: 70, JT_ROYAL_GUARD: 70, JT_WARLOCK: 70, JT_SORCERER: 70, JT_RANGER: 70,
        JT_MINSTREL: 70, JT_WANDERER: 70, JT_ARCHBISHOP: 70, JT_SURA: 70, JT_MECHANIC: 70, JT_GENETIC: 70,
        JT_GUILLOTINE_CROSS: 70, JT_SHADOW_CHASER: 70,
        JT_DRAGON_KNIGHT: 60, JT_IMPERIAL_GUARD: 60, JT_ARCH_MAGE: 60, JT_ELEMENTAL_MASTER: 60,
        JT_WINDHAWK: 60, JT_TROUBADOUR: 60, JT_TROUVERE: 60, JT_CARDINAL: 60, JT_INQUISITOR: 60,
        JT_MEISTER: 60, JT_BIOLO: 60, JT_SHADOW_CROSS: 60, JT_ABYSS_CHASER: 60,
        // 忍者 / 神槍手系：70/70/60
        JT_NINJA: 70, JT_KAGEROU: 70, JT_SHINKIRO: 60,
        JT_OBORO: 70, JT_SHIRANUI: 60,
        JT_GUNSLINGER: 70, JT_REBELLION: 70, JT_NIGHT_WATCH: 60,
        // 跆拳：JT_TAEKWON=50 兩條線共用；拳聖線 JT_STAR=50、JT_STAR_EMPEROR=60；
        // 悟靈線 JT_LINKER=50、JT_SOUL_ASCETIC=70、JT_SOUL_REAPER=60
        JT_TAEKWON: 50,
        JT_STAR: 50, JT_STAR_EMPEROR: 60,
        JT_LINKER: 50, JT_SOUL_ASCETIC: 70, JT_SOUL_REAPER: 60,
        // 召喚師系（魂靈師）：60/60
        JT_DO_SUMMONER: 60, JT_SPIRIT_HANDLER: 60,
        // SuperNovice
        JT_SUPERNOVICE: 99, JT_SUPERNOVICE2: 70, JT_HYPER_NOVICE: 60
    };
    var STANDARD_POINT_CAP = levelToPoints(STANDARD_MAX_LEVEL);

    var STANDARD_LINEAGE = [
        { finalClass: 'RK', stages: ['JT_SWORDMAN', 'JT_KNIGHT', 'JT_RUNE_KNIGHT', 'JT_DRAGON_KNIGHT'] },
        { finalClass: 'RG', stages: ['JT_SWORDMAN', 'JT_CRUSADER', 'JT_ROYAL_GUARD', 'JT_IMPERIAL_GUARD'] },
        { finalClass: 'WL', stages: ['JT_MAGICIAN', 'JT_WIZARD', 'JT_WARLOCK', 'JT_ARCH_MAGE'] },
        { finalClass: 'SO', stages: ['JT_MAGICIAN', 'JT_SAGE', 'JT_SORCERER', 'JT_ELEMENTAL_MASTER'] },
        { finalClass: 'RA', stages: ['JT_ARCHER', 'JT_HUNTER', 'JT_RANGER', 'JT_WINDHAWK'] },
        { finalClass: 'MI', stages: ['JT_ARCHER', 'JT_BARD', 'JT_MINSTREL', 'JT_TROUBADOUR'] },
        { finalClass: 'WA', stages: ['JT_ARCHER', 'JT_DANCER', 'JT_WANDERER', 'JT_TROUVERE'] },
        { finalClass: 'AB', stages: ['JT_ACOLYTE', 'JT_PRIEST', 'JT_ARCHBISHOP', 'JT_CARDINAL'] },
        { finalClass: 'SU', stages: ['JT_ACOLYTE', 'JT_MONK', 'JT_SURA', 'JT_INQUISITOR'] },
        { finalClass: 'ME', stages: ['JT_MERCHANT', 'JT_BLACKSMITH', 'JT_MECHANIC', 'JT_MEISTER'] },
        { finalClass: 'GE', stages: ['JT_MERCHANT', 'JT_ALCHEMIST', 'JT_GENETIC', 'JT_BIOLO'] },
        { finalClass: 'GX', stages: ['JT_THIEF', 'JT_ASSASSIN', 'JT_GUILLOTINE_CROSS', 'JT_SHADOW_CROSS'] },
        { finalClass: 'SC', stages: ['JT_THIEF', 'JT_ROGUE', 'JT_SHADOW_CHASER', 'JT_ABYSS_CHASER'] },
        { finalClass: 'RE', stages: ['JT_GUNSLINGER', 'JT_REBELLION', 'JT_NIGHT_WATCH'] },
        { finalClass: 'KO', stages: ['JT_NINJA', 'JT_KAGEROU', 'JT_SHINKIRO'] },
        { finalClass: 'OB', stages: ['JT_NINJA', 'JT_OBORO', 'JT_SHIRANUI'] },
        { finalClass: 'SN', stages: ['JT_SUPERNOVICE', 'JT_SUPERNOVICE2', 'JT_HYPER_NOVICE'] },
        { finalClass: 'SE', stages: ['JT_TAEKWON', 'JT_STAR', 'JT_STAR_EMPEROR'] },
        { finalClass: 'SL', stages: ['JT_TAEKWON', 'JT_LINKER', 'JT_SOUL_ASCETIC', 'JT_SOUL_REAPER'] },
        { finalClass: 'SUM', stages: ['JT_DO_SUMMONER', 'JT_SPIRIT_HANDLER'] }
    ];

    // 兩份資料來源的總表：basePath 對應 data/grf/<xxx>/ 的資料夾名稱
    var DATASETS = {
        zero: { key: 'zero', label: 'Zero', basePath: 'grf/zero/', pointCap: ZERO_POINT_CAP, lineage: ZERO_LINEAGE },
        standard: { key: 'standard', label: '四轉服版本', basePath: 'grf/standard/', pointCap: STANDARD_POINT_CAP, lineage: STANDARD_LINEAGE }
    };

    function stripColorCodes(s) {
        return typeof s === 'string' ? s.replace(COLOR_CODE_RE, '').trim() : s;
    }

    // hybrid array（具名屬性 + 數字 index）-> 純 JS 陣列，只取連續數字 index 部分
    function toCleanArray(raw) {
        if (!raw) return [];
        var out = [];
        var i = 0;
        while (raw[i] !== undefined) { out.push(raw[i]); i++; }
        return out;
    }

    // NeedSkillList 的原始 pair 陣列 -> [{skid, level}]（沒給等級的視為 1）
    function normalizeNeedList(raw) {
        return toCleanArray(raw).map(function (p) {
            var arr = toCleanArray(p);
            return { skid: arr[0], level: (arr.length > 1 ? arr[1] : 1) };
        });
    }

    async function fetchBig5Text(url) {
        var res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
        var buf = await res.arrayBuffer();
        return new TextDecoder('big5').decode(buf);
    }

    async function loadSkillTreeData(basePath) {
        var warnings = [];
        var onWarning = function (msg) { warnings.push(msg); console.warn('[SkillTreeData]', msg); };

        // skilldelaylist.lua 不是每個資料來源都有（例如標準版/四轉沒有提供），
        // 缺檔案就當作沒有詠唱延遲資料，不要讓整份技能樹都載入失敗。
        var texts = await Promise.all([
            fetchBig5Text(basePath + 'skilltreeview.lua'),
            fetchBig5Text(basePath + 'skillinfolist.lua'),
            fetchBig5Text(basePath + 'skilldescript.lua'),
            fetchBig5Text(basePath + 'skilldelaylist.lua').catch(function (e) {
                onWarning('skilldelaylist.lua 無法載入（' + e.message + '），此資料來源將略過詠唱延遲資訊');
                return '';
            })
        ]);

        var treeRaw = (LuaTableParser.parse(texts[0], { onWarning: onWarning }).SKILL_TREEVIEW_FOR_JOB) || [];
        var infoRaw = (LuaTableParser.parse(texts[1], { onWarning: onWarning }).SKILL_INFO_LIST) || [];
        var descRaw = (LuaTableParser.parse(texts[2], { onWarning: onWarning }).SKILL_DESCRIPT) || [];
        var delayRaw = (LuaTableParser.parse(texts[3], { onWarning: onWarning }).SKILL_DELAY_LIST) || [];

        // ---- skillTreeByJob: {jobKey: [{col,row,colInRow,skid}]}（依 col 排序，去除 hole）----
        var skillTreeByJob = {};
        Object.keys(treeRaw).forEach(function (jobKey) {
            if (jobKey === 'JT_NOVICE') return; // 不使用新手職業頁
            var cols = treeRaw[jobKey];
            var entries = [];
            Object.keys(cols).forEach(function (colStr) {
                var col = Number(colStr);
                if (isNaN(col) || cols[col] === undefined) return;
                entries.push({ col: col, row: Math.floor(col / COLS_PER_ROW), colInRow: col % COLS_PER_ROW, skid: cols[col] });
            });
            entries.sort(function (a, b) { return a.col - b.col; });
            skillTreeByJob[jobKey] = entries;
        });

        // ---- skillInfo: {skid: {maxLv, spAmount[], needSkillListDefault, needSkillListOverrides}} ----
        var skillInfo = {};
        Object.keys(infoRaw).forEach(function (skid) {
            var raw = infoRaw[skid];
            var overrides = {};
            if (raw.NeedSkillList) {
                Object.keys(raw.NeedSkillList).forEach(function (jobKey) {
                    overrides[jobKey] = normalizeNeedList(raw.NeedSkillList[jobKey]);
                });
            }
            skillInfo[skid] = {
                skid: skid,
                rawName: raw[0],
                maxLv: raw.MaxLv || 1,
                spAmount: toCleanArray(raw.SpAmount),
                needSkillListDefault: normalizeNeedList(raw._NeedSkillList),
                needSkillListOverrides: overrides
            };
        });

        // ---- skillDescript: {skid: {nameZh, nameEn, lines[]}}（去色碼，第一行拆中英名）----
        var skillDescript = {};
        Object.keys(descRaw).forEach(function (skid) {
            var lines = toCleanArray(descRaw[skid]).map(stripColorCodes);
            var nameLine = lines[0] || skid;
            var m = /^(.*?)[（(](.*)[）)]\s*$/.exec(nameLine);
            var nameZh = nameLine, nameEn = '';
            if (m) { nameZh = m[1].trim(); nameEn = m[2].trim(); }
            skillDescript[skid] = { nameZh: nameZh, nameEn: nameEn, lines: lines.slice(1) };
        });

        // ---- skillDelay: {skid: {fixedDelay[], statDelay[], singlePostDelay[], globalPostDelay[]}} ----
        var skillDelay = {};
        Object.keys(delayRaw).forEach(function (skid) {
            var raw = delayRaw[skid];
            skillDelay[skid] = {
                fixedDelay: toCleanArray(raw.SkillCastFixedDelay),
                statDelay: toCleanArray(raw.SkillCastStatDelay),
                singlePostDelay: toCleanArray(raw.SkillSinglePostDelay),
                globalPostDelay: toCleanArray(raw.SkillGlobalPostDelay)
            };
        });

        return {
            skillTreeByJob: skillTreeByJob,
            skillInfo: skillInfo,
            skillDescript: skillDescript,
            skillDelay: skillDelay,
            warnings: warnings
        };
    }

    // 目前這頁 JOBID 對某個技能生效的前置需求（有 override 用 override，否則用預設）
    function getEffectiveNeedList(skillInfo, jobKey, skid) {
        var entry = skillInfo[skid];
        if (!entry) return [];
        if (entry.needSkillListOverrides && entry.needSkillListOverrides[jobKey]) {
            return entry.needSkillListOverrides[jobKey];
        }
        return entry.needSkillListDefault || [];
    }

    // 簡易 CSV 逐行分割（支援雙引號包欄位與 "" 逸出，這幾個檔案不會有更複雜的情況）
    function parseCsvLine(line) {
        var out = [];
        var cur = '';
        var inQuotes = false;
        for (var i = 0; i < line.length; i++) {
            var c = line[i];
            if (inQuotes) {
                if (c === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
                } else { cur += c; }
            } else {
                if (c === '"') inQuotes = true;
                else if (c === ',') { out.push(cur); cur = ''; }
                else cur += c;
            }
        }
        out.push(cur);
        return out;
    }

    // 回傳 {skid: {locale: name}}（每個語系一欄），讓呼叫端依目前 UI 語系自己選要顯示哪個，
    // 不在這裡寫死 zh-TW——跟計算機主程式 uiTranslations/skillTranslations 同一種格式。
    async function loadSkillI18n(url) {
        var res = await fetch(url);
        var text = await res.text();
        var lines = text.split(/\r?\n/).filter(function (l) { return l.length > 0; });
        if (lines.length === 0) return {};
        var header = parseCsvLine(lines[0]);
        var map = {};
        for (var i = 1; i < lines.length; i++) {
            var cols = parseCsvLine(lines[i]);
            if (!cols[0]) continue;
            var entry = {};
            for (var c = 1; c < header.length; c++) {
                if (cols[c]) entry[header[c]] = cols[c];
            }
            map[cols[0]] = entry;
        }
        return map;
    }

    async function loadSkillIconMap(url) {
        try {
            var res = await fetch(url);
            if (!res.ok) return {};
            var text = await res.text();
            var lines = text.split(/\r?\n/).filter(function (l) { return l.length > 0; });
            var map = {};
            for (var i = 1; i < lines.length; i++) {
                var cols = parseCsvLine(lines[i]);
                if (cols[0] && cols[1]) map[cols[0]] = cols[1];
            }
            return map;
        } catch (e) {
            return {};
        }
    }

    // 任務取得技能清單：純文字檔，一行一個技能代碼（不含 SKID. 前綴），
    // 空行、# 開頭的註解行忽略。這些技能不能被使用者調整等級，也不計入已用點數。
    async function loadQuestSkillSet(url) {
        try {
            var res = await fetch(url);
            if (!res.ok) return {};
            var text = await res.text();
            var set = {};
            text.split(/\r?\n/).forEach(function (line) {
                var s = line.trim();
                if (!s || s.charAt(0) === '#') return;
                set[s] = true;
            });
            return set;
        } catch (e) {
            return {};
        }
    }

    global.SkillTreeData = {
        DATASETS: DATASETS,
        COLS_PER_ROW: COLS_PER_ROW,
        loadSkillTreeData: loadSkillTreeData,
        getEffectiveNeedList: getEffectiveNeedList,
        loadSkillI18n: loadSkillI18n,
        loadSkillIconMap: loadSkillIconMap,
        loadQuestSkillSet: loadQuestSkillSet,
        parseCsvLine: parseCsvLine
    };
})(typeof window !== 'undefined' ? window : this);
