/*
 * RO 攻速計算機 - ASPD 懲罰表資料
 *
 * 實際的 ASPD 計算公式已搬到 Cloudflare Worker（見 index.html 的 FetchAndApplyASPD()，
 * 呼叫 /compute-aspd）。這個檔案現在只保留公開的懲罰表資料 + 查表輔助函式，
 * 給「攻速懲罰表」參考顯示 dialog 用。
 */
(function (global) {
    'use strict';

    // ------------------------------------------------------------------
    // 1. 攻速懲罰表（三轉版，已涵蓋前置二轉職業；空白 = 0）
    //    第一個欄位「空手」同時是該職業的 Base ASPD。
    //    樂園版與四轉服版的職業列名稱、欄位結構相同，只有數字不同，
    //    所以拆成兩份獨立的表，各自可以直接手動修改數值。
    // ------------------------------------------------------------------
    // 樂園版：二轉(base)/進階二轉(extended)只保留「進階二轉」的數值，兩者共用同一份資料，
    // 差異已知只有 祭司/神官(盾) 與 騎士/騎士領主(雙手劍)，一律採用進階二轉那邊的數字。
    var ASPD_PENALTY_TABLE_PARADISE = (function () {
        var table = {
            "服事": { "空手": 156, "盾": -7, "鈍器": -5, "單手杖": -20, "雙手杖": -20 },
            "弓箭手": { "空手": 156, "盾": -9, "短劍": -15, "弓": -10 },
            "魔法師": { "空手": 146, "盾": -10, "單手杖": -5, "雙手杖": -5, "短劍": 0 },
            "商人": { "空手": 156, "盾": -5, "鈍器": -10, "短劍": -12, "單手劍": -12, "單手斧": -8, "雙手斧": -15 },
            "劍士": { "空手": 156, "盾": -5, "鈍器": -10, "短劍": -7, "單手劍": -7, "雙手劍": -14, "單手斧": -15, "雙手斧": -20, "單手矛": -17, "雙手矛": -25 },
            "盜賊": { "空手": 156, "盾": -6, "短劍": -8, "弓": -13, "單手劍": -10, "單手斧": -20 }
        };

        var SHARED_ROWS = [
            [["祭司", "神官"], { "空手": 156, "盾": -3, "鈍器": -3, "單手杖": -20, "雙手杖": -20, "書": -4, "拳套": -20 }],
            [["武僧", "武術宗師"], { "空手": 156, "盾": -3, "鈍器": -3, "單手杖": -20, "雙手杖": -18, "拳套": 0 }],
            [["獵人", "神射手"], { "空手": 156, "盾": -9, "短劍": -13, "弓": -7 }],
            [["詩人", "搞笑藝人"], { "空手": 156, "盾": -5, "短劍": -13, "弓": -8, "樂器": -5 }],
            [["舞孃", "冷豔舞姬"], { "空手": 156, "盾": -5, "短劍": -13, "弓": -8, "鞭子": -5 }],
            [["巫師", "超魔導士"], { "空手": 146, "盾": -8, "單手杖": -3, "雙手杖": -3, "短劍": -4 }],
            [["賢者", "智者"], { "空手": 151, "盾": -3, "單手杖": -10, "雙手杖": -10, "短劍": -8, "書": 2 }],
            [["鐵匠", "神工匠"], { "空手": 156, "盾": -5, "鈍器": -8, "短劍": -10, "單手劍": -10, "單手斧": -6, "雙手斧": -10 }],
            [["煉金術師", "創造者"], { "空手": 156, "盾": -4, "鈍器": -5, "短劍": -10, "單手劍": -5, "單手斧": -5, "雙手斧": -12 }],
            [["騎士", "騎士領主"], { "空手": 156, "盾": -5, "鈍器": -5, "短劍": -9, "單手劍": -5, "雙手劍": -3, "單手斧": -10, "雙手斧": -15, "單手矛": -15, "雙手矛": -20 }],
            [["十字軍", "聖殿十字軍"], { "空手": 156, "盾": -5, "鈍器": -5, "短劍": -8, "單手劍": -3, "雙手劍": -15, "單手斧": -10, "雙手斧": -15, "單手矛": -13, "雙手矛": -10 }],
            [["刺客", "十字刺客"], { "空手": 156, "短劍": -2, "單手劍": -10, "單手斧": -11, "拳刃": -2 }],
            [["刺客(左手)", "十字刺客(左手)"], { "盾": -6, "短劍": -10, "單手劍": -12, "單手斧": -12 }],
            [["流氓", "神行太保"], { "空手": 156, "盾": -3, "短劍": -5, "弓": -10, "單手劍": -10 }]
        ];
        SHARED_ROWS.forEach(function (entry) {
            var names = entry[0];
            var data = entry[1];
            names.forEach(function (name) {
                table[name] = data;
            });
        });

        // 忍者系列(KO/OB)、槍手系列(RE)：目前數字先複製自四轉服版，之後請直接在這裡改成樂園版實際數值。
        var KO_OB_RE_SHARED_ROWS = [
            [["忍者"], { "空手": 156, "盾": -6, "短劍": -3, "風魔飛鏢": -15 }],
            [["朧", "影狼", "流浪忍者", "疾風忍者"], { "空手": 156, "盾": -3, "短劍": -5, "風魔飛鏢": -10 }],
            [["神槍手"], { "空手": 156, "盾": -6, "手槍": 5, "來福": -5, "霰彈": -40, "格林": 0, "榴彈": -50 }],
            [["反叛", "夜行使"], { "空手": 156, "盾": -10, "手槍": -5, "來福": -10, "霰彈": -45, "格林": -3, "榴彈": -35 }]
        ];
        KO_OB_RE_SHARED_ROWS.forEach(function (entry) {
            var names = entry[0];
            var data = entry[1];
            names.forEach(function (name) {
                table[name] = data;
            });
        });

        return table;
    })();

    // 四轉服版攻速懲罰表。
    // 二轉/進階二轉(神官/武術宗師/神射手...)的懲罰數值大多相同，所以拆成：
    //   1) 1st_ROWS：沒有二轉延伸對象的職業列（服事/弓箭手/魔法師/商人/劍士/盜賊）
    //   2) SHARED_ROWS：[[列名1, 列名2, ...], 數值]，同一組列名共用同一份數值，只需要改一次
    // 若某個職業的二轉/進階二轉數值之後不一樣了，把它從 SHARED_ROWS 移出、改成各自獨立的一列即可。
    var ASPD_PENALTY_TABLE_OFFICIAL = (function () {
        var table = {
            "服事": { "空手": 154, "盾": -7, "鈍器": -5, "單手杖": -20, "雙手杖": -20 },
            "弓箭手": { "空手": 154, "盾": -9, "短劍": -15, "弓": -10 },
            "魔法師": { "空手": 144, "盾": -10, "單手杖": -5, "雙手杖": -5, "短劍": 0 },
            "商人": { "空手": 154, "盾": -5, "鈍器": -10, "短劍": -12, "單手劍": -12, "單手斧": -8, "雙手斧": -15 },
            "劍士": { "空手": 154, "盾": -5, "鈍器": -10, "短劍": -7, "單手劍": -7, "雙手劍": -14, "單手斧": -15, "雙手斧": -20, "單手矛": -17, "雙手矛": -25 },
            "盜賊": { "空手": 154, "盾": -6, "短劍": -8, "弓": -13, "單手劍": -10, "單手斧": -20 }
        };

        var SHARED_ROWS = [
            [["祭司", "神官"], { "空手": 154, "盾": -5, "鈍器": -3, "單手杖": -20, "雙手杖": -20, "書": -4, "拳套": -20 }],
            [["武僧", "武術宗師"], { "空手": 154, "盾": -3, "鈍器": -3, "單手杖": -20, "雙手杖": -18, "拳套": 0 }],
            [["獵人", "神射手"], { "空手": 154, "盾": -9, "短劍": -13, "弓": -8 }],
            [["詩人", "搞笑藝人"], { "空手": 154, "盾": -5, "短劍": -13, "弓": -8, "樂器": -5 }],
            [["舞孃", "冷豔舞姬"], { "空手": 154, "盾": -5, "短劍": -13, "弓": -8, "鞭子": -5 }],
            [["巫師", "超魔導士"], { "空手": 144, "盾": -8, "單手杖": -3, "雙手杖": -3, "短劍": -4 }],
            [["賢者", "智者"], { "空手": 149, "盾": -5, "單手杖": -10, "雙手杖": -10, "短劍": -8, "書": 2 }],
            [["鐵匠", "神工匠"], { "空手": 154, "盾": -5, "鈍器": -8, "短劍": -10, "單手劍": -10, "單手斧": -6, "雙手斧": -13 }],
            [["煉金術師", "創造者"], { "空手": 154, "盾": -4, "鈍器": -5, "短劍": -10, "單手劍": -5, "單手斧": -5, "雙手斧": -12 }],
            [["騎士", "騎士領主"], { "空手": 154, "盾": -5, "鈍器": -5, "短劍": -9, "單手劍": -5, "雙手劍": -12, "單手斧": -10, "雙手斧": -15, "單手矛": -15, "雙手矛": -20 }],
            [["十字軍", "聖殿十字軍"], { "空手": 154, "盾": -5, "鈍器": -5, "短劍": -8, "單手劍": -3, "雙手劍": -15, "單手斧": -10, "雙手斧": -15, "單手矛": -13, "雙手矛": -12 }],
            [["刺客", "十字刺客"], { "空手": 154, "短劍": -2, "單手劍": -10, "單手斧": -11, "拳刃": -2 }],
            [["刺客(左手)", "十字刺客(左手)"], { "盾": -6, "短劍": -10, "單手劍": -12, "單手斧": -12 }],
            [["流氓", "神行太保"], { "空手": 154, "盾": -5, "短劍": -5, "弓": -10, "單手劍": -10 }]
        ];
        SHARED_ROWS.forEach(function (entry) {
            var names = entry[0];
            var data = entry[1];
            names.forEach(function (name) {
                table[name] = data;
            });
        });

        // 三轉/四轉（3rd/4th）專用列，列名採用 classes.json 裡 label 用 "/" 分隔的第2、3段
        // （例如 RK 的 label 是 "騎士/盧恩騎士/盧恩龍爵"，3轉=盧恩騎士、4轉=盧恩龍爵）。
        // 三轉、四轉共用同一份資料。
        var THIRD_FOURTH_SHARED_ROWS = [
            [["盧恩騎士", "盧恩龍爵"], { "空手": 154, "盾": -5, "鈍器": -5, "短劍": -10, "單手劍": -12, "雙手劍": -15, "單手斧": -8, "雙手斧": -12, "單手矛": -20, "雙手矛": -18 }],
            [["十字斬首者", "十字影武"], { "空手": 154, "短劍": -2, "單手劍": -25, "單手斧": -40, "拳刃": -2 }],
            [["十字斬首者(左手)", "十字影武(左手)"], { "盾": -9, "短劍": -10, "單手劍": -12, "單手斧": -12 }],
            [["大主教", "樞機主教"], { "空手": 149, "盾": -5, "鈍器": 0, "單手杖": -15, "雙手杖": -10, "書": 1, "拳套": -5 }],
            [["遊俠", "風鷹狩獵者"], { "空手": 154, "盾": -8, "短劍": -10, "弓": -9 }],
            [["咒術士", "禁咒魔導士"], { "空手": 149, "盾": -8, "單手杖": -5, "雙手杖": -11, "短劍": -7 }],
            [["機械工匠", "機甲神匠"], { "空手": 154, "盾": -6, "鈍器": -8, "短劍": -20, "單手劍": -25, "單手斧": -5, "雙手斧": -8 }],
            [["皇家禁衛軍", "帝國聖衛軍"], { "空手": 154, "盾": -5, "鈍器": -4, "短劍": -7, "單手劍": -5, "雙手劍": -13, "單手斧": -8, "雙手斧": -12, "單手矛": -10, "雙手矛": -10 }],
            [["魅影追蹤者", "深淵追跡者"], { "空手": 154, "盾": -4, "短劍": -3, "弓": -7, "單手劍": -7 }],
            [["修羅", "聖裁者"], { "空手": 156, "盾": -5, "鈍器": -5, "單手杖": -10, "雙手杖": -12, "拳套": -1 }],
            [["宮廷樂師", "天籟頌者"], { "空手": 154, "盾": -7, "短劍": -12, "弓": -9, "樂器": -4 }],
            [["浪跡舞者", "樂之舞靈"], { "空手": 154, "盾": -7, "短劍": -12, "弓": -9, "鞭子": -4 }],
            [["妖術師", "元素支配者"], { "空手": 154, "盾": -5, "單手杖": -5, "雙手杖": -15, "短劍": -10, "書": -5 }],
            [["基因學者", "生命締造者"], { "空手": 154, "盾": -4, "鈍器": -4, "短劍": -10, "單手劍": -4, "單手斧": -8, "雙手斧": -12 }]
        ];
        THIRD_FOURTH_SHARED_ROWS.forEach(function (entry) {
            var names = entry[0];
            var data = entry[1];
            names.forEach(function (name) {
                table[name] = data;
            });
        });

        // 忍者/抬拳/槍手/喵族系列（KO/OB/SE/SL/RE/SUM，classes.json 沒有三段式 label 的職業）。
        // 二轉/進階二轉共用一份資料；三轉/四轉共用另一份，數字相同、只是各 classid 對應的列名不同
        // （third/fourth 的實際列名寫在 CLASSID_TO_ROW，這裡用同一組列名共用同一份資料）。
        var KO_OB_SE_SL_RE_SUM_SHARED_ROWS = [
            [["忍者"], { "空手": 154, "盾": -6, "短劍": -3, "風魔飛鏢": -15 }],
            [["朧", "影狼", "流浪忍者", "疾風忍者"], { "空手": 154, "盾": -3, "短劍": -5, "風魔飛鏢": -10 }],
            [["跆拳"], { "空手": 154, "盾": -6 }],
            [["拳聖", "天帝"], { "空手": 154, "盾": -6, "書": -10 }],
            [["悟靈士", "獵靈士", "契靈士"], { "空手": 144, "盾": -6, "短劍": 0, "單手杖": -3, "雙手杖": -5 }],
            [["神槍手"], { "空手": 144, "盾": -6, "手槍": 5, "來福": -5, "霰彈": -40, "格林": 0, "榴彈": -50 }],
            [["反叛", "夜行使"], { "空手": 149, "盾": -10, "手槍": -5, "來福": -10, "霰彈": -45, "格林": -3, "榴彈": -35 }],
            [["召喚師", "魂靈師"], { "空手": 154, "盾": -7, "雙手杖": -20 }]
        ];
        KO_OB_SE_SL_RE_SUM_SHARED_ROWS.forEach(function (entry) {
            var names = entry[0];
            var data = entry[1];
            names.forEach(function (name) {
                table[name] = data;
            });
        });

        return table;
    })();

    // 刺客系職業的副手一律改查 "(左手)" 資料列（無論副手是盾牌還是武器）
    var LEFT_HAND_ROW = {
        "刺客": "刺客(左手)",
        "十字刺客": "十字刺客(左手)",
        "十字斬首者": "十字斬首者(左手)",
        "十字影武": "十字影武(左手)"
    };

    // ------------------------------------------------------------------
    // 2. 網頁 classid（classes.json 的 id）→ 攻速懲罰表職業列名稱
    //    JobMaxPointType 為 '2nd' 時使用 base；'2nd_extend' 使用 extended；
    //    '3rd' 用 third、'4th' 用 fourth（若該表沒有定義這個列名，退回 extended，
    //    例如樂園版就沒有三四轉專用列，會自動沿用進階二轉的數值）。
    //    third/fourth 的職業名稱取自 classes.json 的 label 用 "/" 分隔的第2、3段。
    //    註：KO/OB/RE/SE/SL/SUM/SN/DR 是原始 Excel 未涵蓋的新職業，查無資料時走 fallback。
    // ------------------------------------------------------------------
    var CLASSID_TO_ROW = {
        RK: { base: "騎士", extended: "騎士領主", third: "盧恩騎士", fourth: "盧恩龍爵" },
        GX: { base: "刺客", extended: "十字刺客", third: "十字斬首者", fourth: "十字影武" },
        AB: { base: "祭司", extended: "神官", third: "大主教", fourth: "樞機主教" },
        RA: { base: "獵人", extended: "神射手", third: "遊俠", fourth: "風鷹狩獵者" },
        WL: { base: "巫師", extended: "超魔導士", third: "咒術士", fourth: "禁咒魔導士" },
        ME: { base: "鐵匠", extended: "神工匠", third: "機械工匠", fourth: "機甲神匠" },
        RG: { base: "十字軍", extended: "聖殿十字軍", third: "皇家禁衛軍", fourth: "帝國聖衛軍" },
        SC: { base: "流氓", extended: "神行太保", third: "魅影追蹤者", fourth: "深淵追跡者" },
        SU: { base: "武僧", extended: "武術宗師", third: "修羅", fourth: "聖裁者" },
        MI: { base: "詩人", extended: "搞笑藝人", third: "宮廷樂師", fourth: "天籟頌者" },
        WA: { base: "舞孃", extended: "冷豔舞姬", third: "浪跡舞者", fourth: "樂之舞靈" },
        SO: { base: "賢者", extended: "智者", third: "妖術師", fourth: "元素支配者" },
        GE: { base: "煉金術師", extended: "創造者", third: "基因學者", fourth: "生命締造者" },

        // KO/OB/SE/SL/RE/SUM：classes.json 的 label 只有兩段（沒有獨立的三/四轉稱號），
        // 二轉、進階二轉共用同一列；三轉、四轉共用另一列（SUM 則四個職等都用同一列）。
        KO: { base: "忍者", extended: "忍者", third: "影狼", fourth: "流浪忍者" },
        OB: { base: "忍者", extended: "忍者", third: "朧", fourth: "疾風忍者" },
        SE: { base: "跆拳", extended: "跆拳", third: "拳聖", fourth: "天帝" },
        SL: { base: "跆拳", extended: "跆拳", third: "獵靈士", fourth: "契靈士" },
        RE: { base: "神槍手", extended: "神槍手", third: "反叛", fourth: "夜行使" },
        SUM: { base: "召喚師", extended: "召喚師", third: "召喚師", fourth: "魂靈師" }
    };

    // 查無資料的職業（不在原始 Excel 表中）一律 fallback：Base ASPD 156、所有懲罰視為 0。
    var FALLBACK_ROW = { "空手": 156 };
    var _warnedMissingClassIds = {};

    // ------------------------------------------------------------------
    // 3. 武器類型（weapon.type.id）→ 攻速懲罰表欄位名稱
    //    杖類/斧類/矛類在網頁目前沒有拆分單手/雙手選項，一律用 isTwohand 決定要查哪一欄。
    // ------------------------------------------------------------------
    var WEAPON_TYPE_TO_KEY = {
        Empty: null,        // 空手：penalty 固定為 0（Base ASPD 已含空手數值）
        Daggers: "短劍",
        OneHandedSwords: "單手劍",
        TwoHandedSword: "雙手劍",
        Katars: "拳刃",
        Spears: "單手矛",
        SpearsTwoHand: "雙手矛",
        Axes: "單手斧",
        AxesTwoHand: "雙手斧",
        Maces: "鈍器",
        Knuckles: "拳套",
        Rods: "單手杖",
        RodsTwoHand: "雙手杖",
        Books: "書",
        Bows: "弓",
        Instruments: "樂器",
        Whips: "鞭子",
        // 槍械類/風魔飛鏢：只有神槍手/反叛/忍者系列有資料，其餘職業的表沒有這些欄位一律視為 0。
        Pistol: "手槍",
        Rifle: "來福",
        Gatling: "格林",
        Shotgun: "霰彈",
        Grenade: "榴彈",
        Shuriken: "風魔飛鏢"
    };

    /**
     * 取得武器類型對應的攻速懲罰表欄位名稱。
     * weapontypelist 的單手矛/雙手矛（Spears/SpearsTwoHand）等已各自獨立成不同 id，
     * 因此這裡不需要再依 isTwohand 額外分流。
     * @param {string} weaponTypeId weapon.type.id
     * @returns {string|null} 欄位名稱；null 代表恆為 0（空手或槍械類）
     */
    function getWeaponPenaltyKey(weaponTypeId) {
        if (Object.prototype.hasOwnProperty.call(WEAPON_TYPE_TO_KEY, weaponTypeId)) {
            return WEAPON_TYPE_TO_KEY[weaponTypeId];
        }
        return null;
    }

    /**
     * 依 classid + JobMaxPointType 取得攻速懲罰表的職業列（含 fallback）。
     * '2nd' 用 base；'2nd_extend' 用 extended；'3rd' 用 third、'4th' 用 fourth，
     * 若該表沒有定義 third/fourth 這個列（例如樂園版沒有三四轉專用資料），自動退回 extended。
     * @param {Object} table ASPD_PENALTY_TABLE_PARADISE 或 ASPD_PENALTY_TABLE_OFFICIAL
     */
    function getPenaltyRow(classid, jobMaxPointType, table) {
        var mapping = CLASSID_TO_ROW[classid];
        if (!mapping) {
            if (!_warnedMissingClassIds[classid]) {
                _warnedMissingClassIds[classid] = true;
                console.warn('[AspdCalculator] 攻速懲罰表沒有職業 "' + classid + '" 的資料，Base ASPD 使用預設值 156，所有武器懲罰視為 0。');
            }
            return { rowName: null, row: FALLBACK_ROW };
        }
        var rowName;
        if (jobMaxPointType === '2nd') {
            rowName = mapping.base;
        } else if (jobMaxPointType === '3rd' && mapping.third && table[mapping.third]) {
            rowName = mapping.third;
        } else if (jobMaxPointType === '4th' && mapping.fourth && table[mapping.fourth]) {
            rowName = mapping.fourth;
        } else {
            rowName = mapping.extended;
        }
        var row = table[rowName];
        if (!row) {
            return { rowName: null, row: FALLBACK_ROW };
        }
        return { rowName: rowName, row: row };
    }

    function getPenaltyValue(row, key) {
        if (!key || !row) return 0;
        var v = row[key];
        return (typeof v === 'number') ? v : 0;
    }

    /**
     * 共用：找出職業列的主手/副手懲罰值（兩套公式都用得到）。
     * @param {Object} table ASPD_PENALTY_TABLE_PARADISE 或 ASPD_PENALTY_TABLE_OFFICIAL（要跟 jobRow 來源同一份表）
     */
    function resolveWeaponPenalties(jobRow, mainWeaponTypeId, offHandKind, offHandWeaponTypeId, table) {
        var mainKey = getWeaponPenaltyKey(mainWeaponTypeId);
        var mainPenalty = getPenaltyValue(jobRow.row, mainKey);

        // 刺客/十字刺客的副手一律改查 "(左手)" 資料列；其餘職業使用自己的列。
        var offHandRow = jobRow.row;
        if (jobRow.rowName && LEFT_HAND_ROW[jobRow.rowName]) {
            offHandRow = table[LEFT_HAND_ROW[jobRow.rowName]] || FALLBACK_ROW;
        }

        var offHandPenalty = 0;
        if (offHandKind === 1) {
            // 盾牌
            offHandPenalty = getPenaltyValue(offHandRow, "盾");
        } else if (offHandKind === 2) {
            // 雙持武器：優先使用副手實際選擇的武器類型；未選擇時退回與主手相同類型。
            var offHandKey = getWeaponPenaltyKey(offHandWeaponTypeId || mainWeaponTypeId);
            offHandPenalty = getPenaltyValue(offHandRow, offHandKey);
        }
        // offHandKind === 0（空手）：penalty 固定為 0

        return { mainPenalty: mainPenalty, offHandPenalty: offHandPenalty };
    }

    // 實際的 ASPD 計算公式（官方 pre-renewal / 樂園 Excel）已搬到 Cloudflare Worker
    // （worker/src/aspd-formula.js），這裡只保留上面的懲罰表資料 + 查表用的輔助函式，
    // 供「攻速懲罰表」參考顯示 dialog 使用（純資料查詢，不含算式本身）。

    global.AspdCalculator = {
        ASPD_PENALTY_TABLE_PARADISE: ASPD_PENALTY_TABLE_PARADISE,
        ASPD_PENALTY_TABLE_OFFICIAL: ASPD_PENALTY_TABLE_OFFICIAL,
        CLASSID_TO_ROW: CLASSID_TO_ROW,
        FALLBACK_ROW: FALLBACK_ROW,
        getWeaponPenaltyKey: getWeaponPenaltyKey,
        getPenaltyRow: getPenaltyRow,
    };
})(typeof window !== 'undefined' ? window : this);
