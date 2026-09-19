/*
 * AI 裝備描述解析 dialog（完全獨立元件，不寫進 index.html）。
 *
 * 用途：使用者貼上裝備的英文/中文說明文字（常常有精鍊等級累加效果、
 * 搭配其他裝備才生效的套裝效果、依裝備階級[D/C/B/A]追加的效果等），
 * 指定「要換算到第幾精鍊」，這個元件會組出一段固定格式的提詞（包含各詞條
 * id 的正負號慣例說明、以及「拆成多個條件區塊」的規則），
 * 由使用者自己複製「提詞＋裝備說明」貼去自己常用的 AI 對話（ChatGPT/Gemini/
 * Claude...皆可），再把 AI 回傳的 JSON 貼回這裡解析、預覽、套用。
 *
 * 完全不呼叫任何 API、不存任何金鑰——純粹是「產生提詞」+「解析使用者貼回來的
 * JSON」兩段本機邏輯。
 *
 * 每個「條件區塊」可以整塊勾選/取消（而不是每條效果分開勾），也能個別修正數值，
 * 按套用後只會把「有勾選的區塊」加總寫回裝備編輯器。
 *
 * 不改動 equipspartlist/effectlist 的資料結構：最終套用出去的還是跟手動新增效果
 * 一樣的 {id, value} 扁平格式，直接對應 effecttypelist 既有的 id——只是套用前
 * 會先把所有勾選區塊裡相同 id 的數值加總起來（例如「固定效果」跟「搭配A裝備」都有
 * 給ATK，兩個區塊都勾選時，最後套用的ATK會是兩者加總，但畫面上仍分開顯示各給多少）。
 *
 * 例外：SkillDamagePercent（技能增傷%）/CDTime（技能獨延），以及 RaceAtkPercent/SizeAtkPercent/
 * LevelAtkPercent/ElementalAtkPercent（及其魔法版本）這幾個id，計算機裡是用targetId區分「全部」
 * 跟「指定某一個」——但同一個id本身可能有些筆是「全部」（例如全種族+5%）、有些筆是「指定」
 * （例如對惡魔+10%），不能只看id判斷，要看AI這一筆有沒有實際給 "skillName"/"targetName"：
 * 有給才是 item.targeted=true 的「指定對象」效果，沒給就是普通扁平效果（跟STR、Atk%這種一樣
 * 直接可編輯數字），千萬不要把id本身當成「這一定是指定對象」的判斷依據。
 * 「指定對象」效果（item.targeted=true）不能直接用扁平{id,value}加總套用，走另一條 apply-skill
 * 事件（一樣是按上方「套用」時才送出，不是每條各自送——事件名稱雖然叫 apply-skill，但同一條
 * 路徑同時處理技能跟種族/體型/階級/屬性目標）。AI沒有完整技能/種族/體型/屬性清單無法可靠猜出
 * 內部代碼，猜對了就直接算「已確認」；猜不到（item.confirmed===false）才會顯示下拉選單+套用鈕
 * 讓使用者手動選、按套用只是把它標成已確認，不會馬上寫進裝備。已確認的效果（不管是猜到的還是
 * 手動選的）只要看它所在的區塊有沒有勾選，就自動納入「指定對象效果加總預覽」——好幾個勾選的
 * 區塊都指定同一個目標時會自動加總，不是各自獨立、也不用個別確認。
 *
 * 使用方式（見 index.html）：
 *   <ai-equip-parser-dialog
 *       :visible.sync="UIPanel['AiEquipParserDialog']"
 *       :effect-type-list="effecttypelist"
 *       :equip-label="EquipSelectLabel"
 *       :t="t"
 *       :skill-options="aiParserSkillOptions"
 *       :effect-tag-class="getEffectTagClass"
 *       :equip-parts="aiParserEquipParts"
 *       :current-part-index="EquipSelectId"
 *       :weapon-type-list="weapontypelist"
 *       :race-options="aiParserRaceOptions"
 *       :size-options="aiParserSizeOptions"
 *       :level-options="aiParserLevelOptions"
 *       :element-options="aiParserElementOptions"
 *       v-on:apply="onAiParserApply"
 *       v-on:apply-skill="onAiParserApplySkill"
 *       v-on:change-part="OpenEditEquipDialogue"
 *       v-on:apply-weapon-base="onAiParserApplyWeaponBase">
 *   </ai-equip-parser-dialog>
 */
(function (global) {
    'use strict';

    // 「對全種族/全體型/全屬性/全階級」跟「對特定種族/體型/屬性/階級」共用同一個id，用targetId
    // 區分（跟技能的targetId機制一樣），只是這裡的targetId有固定前綴（'race:'/'size:'/...）—— 跟
    // index.html 主畫面「指定種族/體型/階級/屬性」用的 makeRaceTargetId 等函式是同一套格式。
    var TARGET_CATEGORIES = {
        race: { atk: 'RaceAtkPercent', matk: 'RaceMatkPercent', prefix: 'race:' },
        size: { atk: 'SizeAtkPercent', matk: 'SizeMatkPercent', prefix: 'size:' },
        level: { atk: 'LevelAtkPercent', matk: 'LevelMatkPercent', prefix: 'level:' },
        element: { atk: 'ElementalAtkPercent', matk: 'ElementalMatkPercent', prefix: 'element:' },
    };

    // 依部位暫存的「步驟1裝備說明」跟「步驟3 AI回覆」文字：{ [partIndex]: { description, replyText } }。
    // 故意放在元件外面（module級別，不是元件的data）：對話框是 v-if 控制的，每次關掉再打開都是全新的
    // 元件實體，如果存在元件自己的data裡，關掉對話框就會整個消失——現在改放這裡，只要頁面沒重新整理，
    // 不管對話框開了幾次、從裝備編輯頁的按鈕開還是從主畫面裝備區塊的按鈕開，同一個部位之前存過的內容
    // 都還在。只存這兩段文字（不存解析出來的groups）；重新整理頁面就會消失，只是「暫時」不是永久保存。
    var partDraftStore = {};

    Vue.component('ai-equip-parser-dialog', {
        props: {
            visible: { type: Boolean, default: false },
            effectTypeList: { type: Array, default: function () { return []; } },
            equipLabel: { type: String, default: '' },
            // 父層的 t(id, fallback) i18n 函式：效果詞條要依目前語系顯示，不要固定顯示中文 label
            t: { type: Function, default: function (id, fallback) { return fallback; } },
            // 父層完整技能清單 [{id, name}]，不管目前選的職業是誰都列出來——裝備寫的技能效果
            // 常常是別的職業的技能。SkillDamagePercent/CDTime 效果靠這份清單讓使用者直接挑，
            // 不用（也不能可靠地）叫AI猜技能內部代碼。
            skillOptions: { type: Array, default: function () { return []; } },
            // 父層的 getEffectTagClass(id) — 回傳 'effect-tag-phys'/'effect-tag-magic'，
            // 讓這裡的詞條也跟主畫面裝備欄/裝備編輯一樣用顏色分辨物理/魔法效果。
            effectTagClass: { type: Function, default: function () { return ''; } },
            // 完整裝備部位清單 [{index, label}] 跟目前開啟中的部位索引——這個對話框是從裝備編輯
            // 頁面開啟的，預設要帶入當時打開的那個部位，但使用者也可以直接在這裡切換到別的部位
            // （切換就是呼叫父層的 change-part，等同直接點主畫面該部位的「編輯」按鈕）。
            equipParts: { type: Array, default: function () { return []; } },
            // 從主畫面裝備區塊的「AI解析」按鈕開啟時（不是從某個部位的裝備編輯頁開的）還沒有對應到
            // 任何部位，父層用空字串 '' 表示「目前沒有開著的部位」，所以型別要接受 String，不能只收 Number。
            currentPartIndex: { type: [Number, String], default: 0 },
            // 武器類型清單 [{id, label}]（weapontypelist），用來把說明文字裡「系列 : 單手杖」
            // 這種文字比對成武器類型的內部id（例如 'Rods'）。只有主手(0)/副手(1)才用得到。
            weaponTypeList: { type: Array, default: function () { return []; } },
            // 種族/體型/階級/屬性清單，各自 [{id, name}]（數字id + 顯示名稱）——跟 skillOptions
            // 同樣的用途：RaceAtkPercent/SizeAtkPercent/LevelAtkPercent/ElementalAtkPercent（及其
            // 魔法版本）指定「特定」種族/體型/階級/屬性時，靠這幾份清單讓使用者挑選正確的目標。
            raceOptions: { type: Array, default: function () { return []; } },
            sizeOptions: { type: Array, default: function () { return []; } },
            levelOptions: { type: Array, default: function () { return []; } },
            elementOptions: { type: Array, default: function () { return []; } },
        },
        data: function () {
            // 元件一開始掛載（不管是重新打開對話框，還是從主畫面按鈕直接開）就先看目前這個部位
            // 之前有沒有存過草稿，有的話直接帶進來，不用等使用者手動切一次部位才觸發 watch。
            var hasPart = this.currentPartIndex !== '' && this.currentPartIndex !== null && this.currentPartIndex !== undefined;
            var initialDraft = hasPart ? partDraftStore[this.currentPartIndex] : null;
            return {
                description: initialDraft ? initialDraft.description : '',
                refineLevel: 0,
                replyText: initialDraft ? initialDraft.replyText : '',
                copyMsg: '',
                errorMsg: '',
                groups: [], // { name, checked, effects: [{id, label, opersymbol, suffixsymbol, value, confirmed}] }
                activeLeftTab: 'main', // 'main' | 'prompt'，左側區塊的分頁
            };
        },
        computed: {
            dialogVisible: {
                get: function () { return this.visible; },
                set: function (v) { this.$emit('update:visible', v); },
            },
            // 下拉選單顯示/切換部位：一律以父層目前實際開啟的部位為準（currentPartIndex），
            // 選了別的部位就請父層真的切過去（跟點主畫面「編輯」按鈕一樣），而不是只改本地顯示。
            selectedPartIndex: {
                get: function () { return this.currentPartIndex; },
                set: function (idx) { this.$emit('change-part', idx); },
            },
            // 只有主手(0)/副手(1)才有「武器基本資料」這回事，其他部位（防具、飾品...）不適用。
            isWeaponPart: function () {
                return this.currentPartIndex === 0 || this.currentPartIndex === 1;
            },
            // 直接用正則從貼上的說明文字裡抓「系列/攻擊/重量/武器等級」這種固定格式的原始欄位
            // （通常是從wiki/資料庫網站複製過來的原始武器資料，不是自然語言，不需要也不該透過
            // AI 才能解析——這裡純本機字串比對，跟上面「條件區塊」那套AI解析流程完全獨立）。
            weaponBaseInfo: function () {
                if (!this.isWeaponPart || !this.description) return null;
                var text = this.description;
                var result = {};
                var typeMatch = text.match(/系列\s*[:：]\s*([^\s\n,，]+)/);
                if (typeMatch) {
                    var typeLabel = typeMatch[1].trim();
                    var typeEntry = this.weaponTypeList.find(function (w) { return w.label === typeLabel; })
                        || this.weaponTypeList.find(function (w) { return w.label.indexOf(typeLabel) > -1 || typeLabel.indexOf(w.label) > -1; });
                    if (typeEntry) result.type = typeEntry;
                }
                var atkMatch = text.match(/攻擊\s*[:：]\s*(-?\d+)/);
                if (atkMatch) result.atk = Number(atkMatch[1]);
                var weightMatch = text.match(/重量\s*[:：]\s*(-?\d+)/);
                if (weightMatch) result.weight = Number(weightMatch[1]);
                var levelMatch = text.match(/武器等級\s*[:：]\s*(\d+)/);
                if (levelMatch) result.level = Number(levelMatch[1]);
                if (!result.type && result.atk === undefined && result.weight === undefined && result.level === undefined) return null;
                return result;
            },
            checkedGroupCount: function () {
                return this.groups.filter(function (g) { return g.checked; }).length;
            },
            combinedPrompt: function () {
                return this.buildPrompt() + '\n\n【裝備說明文字】\n' + this.description.trim();
            },
            mergedPreview: function () {
                // 只用來顯示套用後每個id的加總結果，不影響 groups 本身的顯示。
                // 指定對象的效果（技能/種族/體型/階級/屬性）不走這條加總套用路線——
                // 每個目標各自獨立，不能直接加總寫回單一欄位，要靠 mergedTargetedPreview 處理。
                var self = this;
                var sums = {};
                var order = [];
                this.groups.filter(function (g) { return g.checked; }).forEach(function (g) {
                    g.effects.forEach(function (e) {
                        if (e.targeted) return;
                        if (sums[e.id] === undefined) { sums[e.id] = 0; order.push(e); }
                        sums[e.id] += self.effectiveValue(e, g);
                    });
                });
                return order.map(function (e) {
                    return { id: e.id, label: e.label, opersymbol: e.opersymbol, suffixsymbol: e.suffixsymbol, value: sums[e.id] };
                });
            },
            // 指定對象效果（技能/種族/體型/階級/屬性）的加總預覽：只計入「已勾選區塊」裡「已確認」的
            // 效果（自動猜到的算已確認，猜不到、使用者手動選完按套用的也算已確認），同一個目標
            // 不同區塊都有時要加總顯示，不是各自獨立——跟 mergedPreview 的邏輯一樣，只是多一個
            // targetId當key、多帶resolvedTargetName查出來的可讀名稱。
            mergedTargetedPreview: function () {
                var self = this;
                var sums = {};
                var order = [];
                this.groups.filter(function (g) { return g.checked; }).forEach(function (g) {
                    g.effects.forEach(function (e) {
                        if (!e.targeted || !e.targetId || !e.confirmed) return;
                        var key = e.id + '__' + e.targetId;
                        if (sums[key] === undefined) {
                            sums[key] = {
                                key: key,
                                id: e.id,
                                targetId: e.targetId,
                                targetName: self.resolvedTargetName(e),
                                label: e.label,
                                opersymbol: e.opersymbol,
                                suffixsymbol: e.suffixsymbol,
                                value: 0,
                            };
                            order.push(key);
                        }
                        sums[key].value += self.effectiveValue(e, g);
                    });
                });
                return order.map(function (key) {
                    sums[key].value = Math.round(sums[key].value * 100) / 100;
                    return sums[key];
                });
            },
        },
        watch: {
            // 部位切換（下拉選單改選，或直接在主畫面點別的部位「編輯」）：把新部位之前「按過解析回覆」
            // 時存過的內容（沒解析過就是空字串）帶回輸入框。存的時機是 parseReply()（步驟3按下「解析回覆」
            // 那一刻），不是切部位當下——這裡只負責讀，不負責存，避免把還沒按解析、可能打到一半的文字
            // 誤存成這個部位的暫存內容。
            currentPartIndex: function (newIndex) {
                var saved = partDraftStore[newIndex];
                this.description = saved ? saved.description : '';
                this.replyText = saved ? saved.replyText : '';
                // 只暫存文字、不暫存解析結果：上一個部位解析出來的區塊如果留著，會顯示成這個
                // 新部位的「套用」內容，按下去卻是把別的部位的效果寫進這個部位，所以切部位要清掉，
                // 讓使用者自己對新部位的回覆文字重新按一次「解析回覆」。
                this.groups = [];
                this.errorMsg = '';
                this.copyMsg = '';
            },
        },
        methods: {
            // 帶佔位符的 t()：翻譯字串裡可以用 {key} 代表動態內容（例如筆數、錯誤細節），
            // 各語言翻譯只要保留同樣的 {key} 就能自由調整詞序，不用把整句拆成好幾段 t() 硬接。
            tf: function (key, fallback, params) {
                var text = this.t(key, fallback);
                if (params) {
                    Object.keys(params).forEach(function (k) {
                        text = text.split('{' + k + '}').join(params[k]);
                    });
                }
                return text;
            },
            buildPrompt: function () {
                var typeList = this.effectTypeList.map(function (t) {
                    return { id: t.id, label: t.label, opersymbol: t.opersymbol, suffixsymbol: t.suffixsymbol };
                });
                return [
                    '你是仙境傳說(Ragnarok Online)裝備數值解析助手。',
                    '以下是一件裝備的英文或中文說明文字，裡面常常混雜好幾種不同條件的效果，例如：',
                    '(a) 一直都生效的基礎效果',
                    '(b) 精鍊等級相關效果（可能是「每+N就多一次」的重複規則，也可能是「精鍊到第N階」的固定門檻，這些會跟更低門檻的效果累加）',
                    '(c) 角色自身數值門檻條件（例如「特性素質A、B總和達到多少以上」）',
                    '(d) 搭配某個「指定裝備名稱」時才生效的套裝效果',
                    '(e) 依裝備自身「階級/等級」（例如常見的 [D階級][C階級][B階級][A階級] 分類）追加的效果，通常這種下面每個階級各自列一段',
                    '(f) 依裝備者角色本身的「職業/職業系列」條件（例如「裝備者為妖術師系列時」「裝備者為咒術士系列時」）追加的效果——注意這是角色的職業，跟 (e) 裝備自身的階級是不同的東西，不要混在一起',
                    '(g) 依照「其他部位」（不是這件裝備本身）的精鍊等級計算的效果——可能是單一其他部位（例如編輯的是衣服，但效果寫「披肩精鍊每+2...」），也可能是好幾個部位精鍊合計（例如「披肩、鎧甲精鍊合計每+6...」）。這種精鍊指的不是這件裝備自己的精鍊，是玩家身上「別的」裝備的精鍊，跟 (b) 不一樣，不要混在一起。',
                    '',
                    '請把說明文字拆成多個「條件區塊」，規則如下：',
                    '- (a) 跟 (b)（這件裝備自己的精鍊）一定要合併成同一個區塊，名稱固定叫「固定效果」（不要在名稱裡寫精鍊數字，因為使用者之後可能會調整精鍊）。這個區塊永遠只會有一個。',
                    '- 這個區塊裡每一條效果，依精鍊相關的規則型態分兩種處理方式（同一區塊內不同效果可以各自用不同方式）：',
                    '  1) 如果是「每 +N 精鍊，效果 +M」這種規律遞增（例如「每+3精鍊，OO傷害+4%」代表精鍊值除以N取整數的商數再乘以M），不要自己先算好最終數字，而是輸出 {"id":..., "value": 這條效果跟精鍊規律無關的固定部分（沒有就填0）, "refineInterval": N, "refineStep": M}，讓使用者之後可以自己調整精鍊重新計算，不用重新問一次。',
                    '  2) 如果精鍊條件是不規則的門檻表（例如精鍊7才+3%、精鍊9才+5%，級距或增量不固定），才需要你依照目前指定的「精鍊 +' + this.refineLevel + '」計算出這條效果累加後的最終數字，正常輸出 {"id":..., "value": 最終數字}（不要加 refineInterval/refineStep 欄位）。',
                    '- (c)(d)(e)(f)(g) 每一種不同的條件各自獨立成一個區塊（例如每個不同的「搭配XX裝備」是一個區塊、每個不同的階級是一個區塊、每個不同的數值門檻條件是一個區塊、每個不同的職業條件也是一個區塊、每種不同的「其他部位精鍊依據」也是一個區塊），區塊名稱請直接沿用說明文字裡的條件描述（例如「搭配「守護精靈神盾」」「[D階級]」「特性素質SPL、WIS總和150以上」「裝備者為妖術師系列」「披肩精鍊」「披肩、鎧甲精鍊合計」）。同一件裝備裡如果同時出現好幾種不同類型的條件，彼此獨立、互不合併，各自維持自己的區塊。',
                    '- (g) 區塊內如果是「每+N精鍊，效果+M」規律，一樣要輸出 refineInterval/refineStep（不要自己先猜一個精鍊值算好），因為這個精鍊是「其他部位」的精鍊，使用者會自己在這個區塊輸入他實際的數字，跟最上面「固定效果」用的精鍊是分開的兩個數字。',
                    '- (g) 區塊還要在區塊物件裡額外加一個 "refineParts" 欄位：一個字串陣列，列出這個效果依據哪個/哪些部位的精鍊（用說明文字裡的部位名稱，例如裝備部位常見的「頭飾」「衣服」「披肩」「鞋子」「飾品」等）。只依賴單一部位就填一個元素，例如 ["披肩"]；好幾個部位精鍊合計（例如「披肩、鎧甲精鍊合計」）就把每個部位都列出來，例如 ["披肩","鎧甲"]——使用者會看到你列的每個部位各自出現一個輸入框，自己填各部位實際的精鍊，程式會自動加總後才代入公式，你不用自己猜算合計。',
                    '- 如果某個區塊內部也有精鍊相關的敘述（例如「[D階級] 鞋子精鍊每+2...」，且明確是這件裝備自己的精鍊），一樣用「精鍊 +' + this.refineLevel + '」去計算該區塊內的累加結果。',
                    '- 特別注意：如果 (c)(d)(e)(f) 的某個條件本身還「額外」依賴精鍊門檻才會生效（例如「搭配「A」」一直有基礎效果，但另外寫「搭配「A」時，若精鍊+10以上，再額外增加XX」；門檻可能是該裝備自身精鍊，也可能是搭配套裝的合計精鍊），這個「條件+精鍊門檻」的額外效果要獨立成第三個區塊，不能合併進單純的「搭配A」區塊，也不能合併進最上面的「固定效果」區塊——因為使用者要同時滿足「有搭配A」跟「精鍊真的達到那個門檻」兩件事才成立。這種區塊名稱請包含門檻資訊，例如「搭配「A」+精鍊10以上」。',
                    '',
                    '只能使用下面清單裡的 id，不能自己發明新的 id；清單裡每個項目的 opersymbol 是這個欄位在畫面上顯示的正負號慣例：',
                    'opersymbol 為 "-" 代表這個欄位平常語意是「減少/縮短」某個量（例如可變詠唱時間、攻擊後硬直%、CD、固定詠唱時間都是這種）。',
                    '如果裝備效果是「縮短/減少」該數值，請填正數；如果裝備效果反而是「拉長/增加」該數值（等於是懲罰、負面效果），請填負數。',
                    'opersymbol 為 "+" 的欄位則相反：正常增益填正數，若是懲罰、負面效果則填負數。',
                    '',
                    JSON.stringify(typeList),
                    '',
                    '特別規則：「SkillDamagePercent」（技能增傷 %）和「CDTime」（技能獨延）這兩個 id，計算機這邊沒有把完整的技能清單給你，所以你不需要、也不應該猜測或編造技能的內部代碼。',
                    '如果說明文字裡這兩種效果是指定「某一個特定技能」才生效（例如「毀滅彗星的傷害+7%」「××技能冷卻時間-20秒」），除了照常填 id 和 value，另外加一個 "skillName" 欄位，內容是說明文字裡寫的技能原始名稱（保留原文語言、不要翻譯，例如「毀滅彗星」）；如果是「所有技能」都適用、沒有指定特定技能，則不要加 skillName 欄位。',
                    '',
                    '特別規則：「對全種族/全體型/全屬性/全階級（或特定怪物）對象的傷害」這種依對象分類的加成，清單裡「物理」跟「魔法」是兩個完全獨立的 id，不是同一個東西：種族用 RaceAtkPercent（物理）/RaceMatkPercent（魔法），體型用 SizeAtkPercent（物理）/SizeMatkPercent（魔法），屬性用 ElementalAtkPercent（物理）/ElementalMatkPercent（魔法），階級用 LevelAtkPercent（物理）/LevelMatkPercent（魔法），特定怪物用 MonsterAtkPercent（物理）/MonsterMatkPercent（魔法）。',
                    '如果說明文字寫的是「物理和魔法傷害都+X%」（兩種傷害同時都有），請把物理跟魔法兩個 id 都輸出，各自一筆；如果兩者數值不同，各自填各自寫的數字；如果文字只提到其中一種（只講物理或只講魔法），就只輸出對應的那一個 id，不要自己多加另一個。',
                    '這幾組 id 計算機這邊也沒有把完整的種族/體型/階級/屬性清單給你：如果說明文字指定的是「特定」種族/體型/階級/屬性才生效（例如「對惡魔種族傷害+10%」「對中型怪物傷害+15%」「對BOSS級怪物傷害+20%」「對火屬性怪物傷害+8%」），除了照常填 id 和 value，另外加一個 "targetName" 欄位，內容是說明文字裡寫的種族/體型/階級/屬性原始名稱（保留原文，例如「惡魔」「中型」「BOSS」「火」），不要猜測或編造內部代碼。如果文字寫的是「全部」種族/體型/階級/屬性都適用（沒有指定特定的），則不要加 targetName 欄位。',
                    '如果同一條效果同時指定好幾個特定目標（例如「對中、大型對象的魔法傷害+30%」同時指定中型跟大型；「對惡魔、不死種族傷害+X%」同時指定兩種種族），請把每個目標各自拆成一筆獨立的效果（id 和 value 都一樣，targetName 各自填一個目標名稱），不要把好幾個名稱塞在同一個 targetName 裡——計算機這裡一筆效果只能對應一個目標，你負責拆開，不要留給使用者自己拆。',
                    '',
                    '找不到對應 id 的效果（例如攻擊距離、位移、機率觸發技能、冷卻時間秒數這種清單沒有的東西）請直接忽略，不要放進結果，也不用解釋。',
                    '數值為0或該區塊沒提到的效果不要放進該區塊。百分比欄位請填數字本身（例如7%要填7，不要填0.07）。',
                    '',
                    '只回傳一個 JSON 物件，不要有任何說明文字、不要用 ```json 這種標記包起來，格式如下：',
                    '{"groups": [{"name": "區塊名稱", "refineParts": "只有(g)類型（依據其他部位精鍊）才需要，內容是部位名稱字串陣列，其餘不要加", "effects": [{"id": "清單裡的id", "value": 數字, "refineInterval": "只有規律遞增的精鍊效果才需要，其餘不要加", "refineStep": "只有規律遞增的精鍊效果才需要，其餘不要加", "skillName": "只有 SkillDamagePercent/CDTime 且指定特定技能時才需要，其餘不要加這個欄位", "targetName": "只有指定特定種族/體型/階級/屬性時才需要，其餘不要加這個欄位"}]}]}',
                ].join('\n');
            },
            // SkillDamagePercent（技能增傷%）/CDTime（技能獨延）這兩個id在計算機裡是「所有技能」跟
            // 「指定某個技能」共用同一個id、用targetId區分——AI沒有完整技能清單無法可靠猜出技能內部代碼，
            // 所以這兩個id一律不給數字輸入框，改成從完整技能清單（skillOptions，不限職業）挑選。
            isSkillTargetId: function (id) {
                return id === 'SkillDamagePercent' || id === 'CDTime';
            },
            // 回傳這個id屬於哪個「指定對象」分類（'race'/'size'/'level'/'element'），不是就回傳null。
            getCategoryForId: function (id) {
                for (var key in TARGET_CATEGORIES) {
                    if (TARGET_CATEGORIES[key].atk === id || TARGET_CATEGORIES[key].matk === id) return key;
                }
                return null;
            },
            getCategoryOptions: function (category) {
                if (category === 'race') return this.raceOptions;
                if (category === 'size') return this.sizeOptions;
                if (category === 'level') return this.levelOptions;
                if (category === 'element') return this.elementOptions;
                return [];
            },
            // 用AI讀到的種族/體型/階級/屬性名稱字串，比對成帶前綴的targetId（例如'race:6'）。
            // 邏輯跟guessSkillId一樣：完全比對優先，找不到才用「包含」比對且僅限唯一結果。
            guessCategoryTargetId: function (category, text) {
                var options = this.getCategoryOptions(category);
                if (!text || !options || !options.length) return '';
                var name = text.trim().toLowerCase();
                if (!name) return '';
                var prefix = TARGET_CATEGORIES[category].prefix;
                var exact = options.filter(function (o) { return o.name.toLowerCase() === name; });
                if (exact.length === 1) return prefix + exact[0].id;
                var partial = options.filter(function (o) {
                    var optName = o.name.toLowerCase();
                    return optName.indexOf(name) > -1 || name.indexOf(optName) > -1;
                });
                if (partial.length === 1) return prefix + partial[0].id;
                return '';
            },
            // 下拉選單要用哪份清單：技能用skillOptions（原始id無前綴）；種族/體型/階級/屬性則把
            // 各自清單的數字id加上分類前綴，統一成跟skillOptions一樣的{id,name}格式方便共用模板。
            targetOptionsFor: function (item) {
                if (this.isSkillTargetId(item.id)) return this.skillOptions;
                var category = this.getCategoryForId(item.id);
                if (category) {
                    var prefix = TARGET_CATEGORIES[category].prefix;
                    return this.getCategoryOptions(category).map(function (o) { return { id: prefix + o.id, name: o.name }; });
                }
                return [];
            },
            // 已確認效果只存了targetId，這裡查回可讀名稱顯示在畫面上——技能查skillOptions，
            // 種族/體型/階級/屬性則去掉targetId的前綴後查對應清單。
            resolvedTargetName: function (item) {
                if (this.isSkillTargetId(item.id)) return this.skillTargetName(item);
                var category = this.getCategoryForId(item.id);
                if (category && item.targetId) {
                    var prefix = TARGET_CATEGORIES[category].prefix;
                    var rawId = item.targetId.indexOf(prefix) === 0 ? item.targetId.slice(prefix.length) : item.targetId;
                    var opt = this.getCategoryOptions(category).find(function (o) { return String(o.id) === rawId; });
                    return opt ? opt.name : item.targetId;
                }
                return item.targetId;
            },
            // 這個區塊裡有沒有任何「每+N精鍊」規律效果——只有這種區塊才需要顯示自己的精鍊輸入框
            // （非固定效果區塊，例如搭配裝備/其他部位精鍊），其餘區塊維持原本乾淨的樣子不用多顯示。
            groupHasFormula: function (group) {
                return group.effects.some(function (e) { return !!e.refineInterval; });
            },
            // 「每+N精鍊，效果+M」規律效果的即時數值：固定部分 + floor(精鍊/N)*M，隨精鍊輸入即時重算，
            // 不需要重新問AI。非規律效果就直接用value本身。
            //
            // 精鍊用哪一個數字：group.isPrimary（第一個「固定效果」區塊）的效果一定是「這件裝備自己」的
            // 精鍊，用最上面「要換算到第幾精鍊」的 this.refineLevel；其他區塊（搭配裝備/職業條件/
            // 「其他部位精鍊」等）各自用自己的 group.refineParts 陣列加總——可能只有一個部位（例如
            // 「披肩精鍊」），也可能好幾個部位精鍊合計（例如「披肩、鎧甲精鍊合計」各自一個輸入框，
            // 這裡自動加總，不用使用者自己心算），因為那些精鍊指的可能是完全不同的裝備，不能跟目前
            // 正在編輯的這件裝備共用同一個數字。
            effectiveValue: function (item, group) {
                if (item.refineInterval) {
                    var interval = Number(item.refineInterval) || 1;
                    var step = Number(item.refineStep) || 0;
                    var base = Number(item.value) || 0;
                    var refine = this.refineLevel;
                    if (group && !group.isPrimary) {
                        refine = (group.refineParts || []).reduce(function (sum, p) { return sum + (Number(p.value) || 0); }, 0);
                    }
                    var total = base + Math.floor(refine / interval) * step;
                    return Math.round(total * 100) / 100;
                }
                return Number(item.value) || 0;
            },
            // 已確認（confirmed）的技能效果只存了targetId，這裡查回可讀的技能名稱顯示在畫面上。
            skillTargetName: function (item) {
                var matched = this.skillOptions.find(function (opt) { return opt.id === item.targetId; });
                return matched ? matched.name : item.targetId;
            },
            // 用AI讀到的技能名稱字串，在完整技能清單裡找一個最可能符合的，讓使用者少打幾個字。
            // 完全比對優先；找不到就用「包含」比對，但只有唯一一筆結果時才採用，避免誤選。
            guessSkillId: function (skillName) {
                if (!skillName) return '';
                var name = skillName.trim().toLowerCase();
                if (!name) return '';
                var exact = this.skillOptions.filter(function (opt) { return opt.name.toLowerCase() === name; });
                if (exact.length === 1) return exact[0].id;
                var partial = this.skillOptions.filter(function (opt) {
                    var optName = opt.name.toLowerCase();
                    return optName.indexOf(name) > -1 || name.indexOf(optName) > -1;
                });
                if (partial.length === 1) return partial[0].id;
                return '';
            },
            // 使用者手動從下拉選單挑了技能、按下「套用」確認——這裡只是把這個item標成「已確認」，
            // 讓它跟自動猜到的技能一樣，之後單純看區塊有沒有勾選來決定要不要納入加總預覽/最終套用，
            // 不會在這裡就直接寫進裝備（真正寫入是按對話框上方的「套用（N區塊）」時才做）。
            onConfirmTargetPick: function (item) {
                if (!item.targetId) return;
                item.confirmed = true;
            },
            // 把偵測到的武器基本資料（系列/攻擊/重量/武器等級）送給父層寫進weapon/subweapon——
            // 這個對話框不知道weapon/subweapon物件長怎樣，只負責把解析出來的原始數字/類型丟出去。
            onApplyWeaponBase: function () {
                var info = this.weaponBaseInfo;
                if (!info) return;
                this.$emit('apply-weapon-base', {
                    partIndex: this.currentPartIndex,
                    type: info.type || null,
                    atk: info.atk,
                    weight: info.weight,
                    level: info.level,
                });
            },
            copyPrompt: function () {
                var self = this;
                var text = this.combinedPrompt;
                var done = function () {
                    self.copyMsg = self.t('ui.aiparser.copy.success', '已複製！請貼到你常用的 AI 對話（ChatGPT / Gemini / Claude...皆可），把 AI 的回覆貼回下面的欄位。');
                };
                var fail = function () {
                    self.copyMsg = self.t('ui.aiparser.copy.fail', '自動複製失敗，請切換到「提詞預覽」分頁手動全選（Ctrl+A）複製。');
                    self.activeLeftTab = 'prompt';
                    self.$nextTick(function () {
                        var el = self.$refs.promptTextarea && self.$refs.promptTextarea.$el
                            && self.$refs.promptTextarea.$el.querySelector('textarea');
                        if (el) { el.focus(); el.select(); }
                    });
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text).then(done).catch(fail);
                } else {
                    fail();
                }
            },
            parseReply: function () {
                var self = this;
                // 按下「解析回覆」才是暫存這個部位步驟1/3文字的時機（不是切部位當下），這樣切去別的
                // 部位、甚至把整個對話框關掉再重開，回到這個部位都會帶回「上次按解析時」的內容。
                // 沒有對應到任何部位（從主畫面按鈕直接開、還沒選部位）就沒地方存，先不存。
                if (this.currentPartIndex !== '' && this.currentPartIndex !== null && this.currentPartIndex !== undefined) {
                    partDraftStore[this.currentPartIndex] = { description: this.description, replyText: this.replyText };
                }
                this.errorMsg = '';
                this.groups = [];
                var raw = this.replyText.trim();
                if (!raw) return;

                var cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
                var parsed;
                try {
                    parsed = JSON.parse(cleaned);
                } catch (e) {
                    this.errorMsg = this.tf('ui.aiparser.error.invalidjson', '貼上的內容不是合法的 JSON，請確認是否完整複製了 AI 的回覆：{detail}', { detail: cleaned.slice(0, 200) });
                    return;
                }

                var rawGroups = parsed && Array.isArray(parsed.groups) ? parsed.groups : null;
                if (!rawGroups) {
                    this.errorMsg = this.t('ui.aiparser.error.badformat', '貼上的 JSON 格式不是預期的 {groups:[...]}');
                    return;
                }

                var typeMap = {};
                this.effectTypeList.forEach(function (t) { typeMap[t.id] = t; });

                var unknownIds = []; // 記錄回覆裡有但我們清單裡沒有的id，方便診斷
                this.groups = rawGroups.map(function (g, idx) {
                    var effects = (Array.isArray(g.effects) ? g.effects : [])
                        .filter(function (row) {
                            if (!row) return false;
                            if (!typeMap[row.id]) { unknownIds.push(row.id); return false; }
                            var hasFormula = Number(row.refineInterval) > 0 && !isNaN(Number(row.refineStep)) && Number(row.refineStep) !== 0;
                            return hasFormula || (Number(row.value) !== 0 && !isNaN(Number(row.value)));
                        })
                        .map(function (row) {
                            var t = typeMap[row.id];
                            var skillName = (typeof row.skillName === 'string') ? row.skillName : '';
                            var targetName = (typeof row.targetName === 'string') ? row.targetName : '';
                            var hasFormula = Number(row.refineInterval) > 0 && !isNaN(Number(row.refineStep)) && Number(row.refineStep) !== 0;
                            // 猜一個最可能符合的目標（技能，或種族/體型/階級/屬性），讓使用者少打幾個字；
                            // 猜不到或不唯一就留空，使用者自己在下拉選單搜尋。猜到了就直接算「已確認」，
                            // 不用使用者再按一次套用；猜不到才需要使用者手動選+按套用確認。
                            //
                            // 注意：is targeted 不能只看 id（SkillDamagePercent/RaceAtkPercent這種id本身
                            // 「支援」指定對象，不代表這一筆一定有指定）——要看AI這一筆到底有沒有實際給
                            // skillName/targetName。沒給（例如「全種族」「所有技能」）就是一般扁平效果，
                            // 完全不要走目標確認/下拉選單那條路，直接跟普通效果一樣可編輯數字。
                            var category = self.isSkillTargetId(row.id) ? null : self.getCategoryForId(row.id);
                            var isSkillKind = self.isSkillTargetId(row.id) && !!skillName;
                            var isCategoryKind = !!category && !!targetName;
                            var targeted = isSkillKind || isCategoryKind;
                            var guessedTargetId = '';
                            if (isSkillKind) {
                                guessedTargetId = self.guessSkillId(skillName);
                            } else if (isCategoryKind) {
                                guessedTargetId = self.guessCategoryTargetId(category, targetName);
                            }
                            return {
                                id: t.id,
                                label: t.label,
                                opersymbol: t.opersymbol,
                                suffixsymbol: t.suffixsymbol,
                                value: Number(row.value) || 0,
                                skillName: skillName,
                                targetName: targetName,
                                targetId: guessedTargetId,
                                // 這一筆是不是「指定對象」效果——只有這個是true時才會走下拉選單/確認/
                                // 加總預覽那條路；沒指定（全種族/所有技能等）就是一般效果，跟其他扁平
                                // 數值效果完全一樣處理（見 mergedPreview/applyResults/template 的判斷）。
                                targeted: targeted,
                                confirmed: targeted ? !!guessedTargetId : true,
                                // 「每+N精鍊，效果+M」規律：不預先算好最終數字，讓使用者事後改精鍊也能重新算（見 effectiveValue）
                                refineInterval: hasFormula ? Number(row.refineInterval) : null,
                                refineStep: hasFormula ? Number(row.refineStep) : 0,
                            };
                        });
                    var hasFormulaEffect = effects.some(function (e) { return !!e.refineInterval; });
                    // refineParts：非固定效果區塊裡「每+N精鍊」規律要依據哪個/哪些部位的精鍊——
                    // AI有給就用AI列的部位名稱（例如["披肩","鎧甲"]，好幾個部位精鍊合計時使用者
                    // 會看到好幾個輸入框，各自填實際精鍊，程式自動加總，不用自己心算）；AI沒給
                    // （通常是combo+精鍊門檻那種本來就沒有明確部位名稱的區塊）就退回單一個「此區塊」
                    // 輸入框，維持舊行為，不會沒地方輸入。固定效果區塊(idx 0)不需要，永遠是空陣列。
                    var refineParts = [];
                    if (idx > 0 && hasFormulaEffect) {
                        var rawParts = Array.isArray(g.refineParts)
                            ? g.refineParts.filter(function (s) { return typeof s === 'string' && s.trim(); })
                            : [];
                        var labels = rawParts.length > 0 ? rawParts : [self.t('ui.aiparser.group.thisblock', '此區塊')];
                        refineParts = labels.map(function (label) {
                            return { label: label, value: self.refineLevel };
                        });
                    }
                    return {
                        name: g.name || self.tf('ui.aiparser.group.fallbackname', '區塊 {n}', { n: idx + 1 }),
                        // 第一個區塊固定是「固定效果」，預設勾選；其餘（搭配裝備/階級/數值門檻）預設不勾，
                        // 因為那些是「使用者自己是否真的有搭配/達到門檻」才成立，不該預設套用。
                        checked: idx === 0,
                        // isPrimary：只有第一個「固定效果」區塊的精鍊規律效果，用最上面的 this.refineLevel
                        // （這件裝備自己的精鍊）；其他區塊各自用自己的 refineParts 加總（見 effectiveValue 說明）。
                        isPrimary: idx === 0,
                        refineParts: refineParts,
                        effects: effects,
                    };
                }).filter(function (g) { return g.effects.length > 0; });

                if (this.groups.length === 0) {
                    console.log('[ai_equip_parser] unmatched ids from reply:', unknownIds);
                    this.errorMsg = unknownIds.length > 0
                        ? this.tf('ui.aiparser.error.unknownids', '沒有解析出任何已知效果。回覆裡有計算機不認得的id：{ids}（按F12打開主控台可看到完整清單）', { ids: unknownIds.slice(0, 10).join(', ') })
                        : this.t('ui.aiparser.error.noeffects', '沒有解析出任何已知效果，請確認貼上的 JSON 內容是否正確');
                }
            },
            applyResults: function () {
                var self = this;
                var sums = {};
                this.groups.filter(function (g) { return g.checked; }).forEach(function (g) {
                    g.effects.forEach(function (e) {
                        if (e.targeted) return;
                        sums[e.id] = (sums[e.id] || 0) + self.effectiveValue(e, g);
                    });
                });
                var chosen = Object.keys(sums).map(function (id) { return { id: id, value: sums[id] }; });
                var targetedChosen = this.mergedTargetedPreview;
                if (chosen.length === 0 && targetedChosen.length === 0) return;
                if (chosen.length > 0) this.$emit('apply', chosen);
                targetedChosen.forEach(function (s) {
                    self.$emit('apply-skill', { id: s.id, value: s.value, targetId: s.targetId, targetName: s.targetName });
                });
                this.dialogVisible = false;
                this.reset();
            },
            reset: function () {
                this.description = '';
                this.replyText = '';
                this.copyMsg = '';
                this.groups = [];
                this.errorMsg = '';
                this.activeLeftTab = 'main';
            },
            onClose: function () {
                this.reset();
            },
        },
        template: [
            '<el-dialog :visible.sync="dialogVisible" custom-class="Dialogue-container" width="80%" top="50px" center v-on:close="onClose">',
            '  <span slot="title">{{ t(\'ui.aiparser.title\', \'AI 裝備效果解析\') }} <b v-if="equipLabel">{{ equipLabel }}</b></span>',
            '  <el-row type="flex" justify="end" :gutter="10" class="ai-parser-actions-row">',
            '    <el-col :span="4"><el-button size="small" v-on:click="dialogVisible = false">{{ t(\'ui.common.cancel\', \'取消\') }}</el-button></el-col>',
            '    <el-col :span="4"><el-button type="success" size="small" :disabled="checkedGroupCount === 0" v-on:click="applyResults">{{ tf(\'ui.aiparser.applyblocks\', \'套用（{n} 區塊）\', { n: checkedGroupCount }) }}</el-button></el-col>',
            '  </el-row>',
            '  <el-row :gutter="14" type="flex" class="ai-parser-columns-row">',
            '    <el-col :span="10" class="ai-parser-column">',
            '      <div class="ai-parser-column-scroll">',
            '        <el-tabs v-model="activeLeftTab" class="ai-parser-tabs">',
            '          <el-tab-pane :label="t(\'ui.aiparser.tab.main\', \'裝備說明與解析\')" name="main">',
            '            <div style="color:#909399; font-size:12px; margin-bottom:6px;">{{ t(\'ui.aiparser.recommendedsites\', \'推薦資料站\') }}：<a href="https://rd.fharr.com/" target="_blank" rel="noopener noreferrer">fharr</a>、<a href="https://www.divine-pride.net/database/item" target="_blank" rel="noopener noreferrer">divine-pride</a></div>',
            '            <div class="ai-parser-step-label">{{ t(\'ui.aiparser.step1\', \'步驟1：貼上裝備說明\') }}</div>',
            '            <el-row :gutter="10">',
            '              <el-col :span="24">',
            '                <el-input type="textarea" :rows="6" v-model="description" :placeholder="t(\'ui.aiparser.step1.placeholder\', \'貼上裝備的完整說明文字（英文/中文皆可，可包含精鍊效果、搭配套裝、階級追加效果）\')"></el-input>',
            '              </el-col>',
            '            </el-row>',
            '            <el-row v-if="weaponBaseInfo" class="bg-purple-light" style="margin-top:8px; padding:8px 10px; border-radius:4px;">',
            '              <el-col :span="24">',
            '                <div style="margin-bottom:4px;"><b>{{ t(\'ui.aiparser.weaponbase.title\', \'偵測到武器基本資料：\') }}</b></div>',
            '                <div style="font-size:13px;">',
            '                  <span v-if="weaponBaseInfo.type">{{ t(\'ui.aiparser.weaponbase.type\', \'系列\') }}：{{ t(weaponBaseInfo.type.id, weaponBaseInfo.type.label) }}　</span>',
            '                  <span v-if="weaponBaseInfo.atk !== undefined">{{ t(\'ui.aiparser.weaponbase.atk\', \'攻擊\') }}：{{ weaponBaseInfo.atk }}　</span>',
            '                  <span v-if="weaponBaseInfo.weight !== undefined">{{ t(\'ui.aiparser.weaponbase.weight\', \'重量\') }}：{{ weaponBaseInfo.weight }}　</span>',
            '                  <span v-if="weaponBaseInfo.level !== undefined">{{ t(\'ui.equip.weaponlevel\', \'武器等級\') }}：{{ weaponBaseInfo.level }}</span>',
            '                </div>',
            '                <el-button type="primary" size="mini" style="margin-top:6px;" v-on:click="onApplyWeaponBase">{{ t(\'ui.aiparser.weaponbase.applyto\', \'套用到\') }}{{ equipParts[currentPartIndex] ? equipParts[currentPartIndex].label : \'\' }}</el-button>',
            '              </el-col>',
            '            </el-row>',
            '            <div class="ai-parser-step-label" style="margin-top:10px;">{{ t(\'ui.aiparser.step2\', \'步驟2：選擇部位／精鍊，並複製到任何 AI Chat\') }}<span style="font-weight:normal; color:#909399; font-size:12px; margin-left:4px;">（{{ t(\'ui.aiparser.step2.hint.prefix\', \'例如\') }} <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">ChatGPT</a>、<a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer">Gemini</a>、<a href="https://claude.ai" target="_blank" rel="noopener noreferrer">Claude</a> {{ t(\'ui.aiparser.step2.hint.suffix\', \'等皆可\') }}）</span></div>',
            '            <el-row :gutter="10" type="flex" align="middle">',
            '              <el-col :span="9">',
            '                <span>{{ t(\'ui.aiparser.refine\', \'精鍊\') }}：</span>',
            '                <el-input-number v-model="refineLevel" :min="0" :max="20" :controls="false" size="small" style="width:80px;" v-on:keyup.enter.native="$event.target.blur()"></el-input-number>',
            '              </el-col>',
            '              <el-col :span="15">',
            '                <span>{{ t(\'ui.aiparser.weaponbase.applyto\', \'套用到\') }}：</span>',
            '                <el-select v-model="selectedPartIndex" filterable size="small" :placeholder="t(\'ui.common.pleaseselect\', \'請選擇\')" style="width:150px;">',
            '                  <el-option v-for="p in equipParts" :key="p.index" :label="p.label" :value="p.index"></el-option>',
            '                </el-select>',
            '              </el-col>',
            '            </el-row>',
            '            <el-row style="margin-top:10px;">',
            '              <el-col :span="24" class="textcenter">',
            '                <el-button type="primary" size="small" :disabled="!description.trim()" v-on:click="copyPrompt">{{ t(\'ui.aiparser.copyprompt\', \'複製提詞＋裝備說明\') }}</el-button>',
            '              </el-col>',
            '            </el-row>',
            '            <el-row v-if="copyMsg" style="margin-top:6px;">',
            '              <el-col :span="24"><el-alert type="info" :title="copyMsg" :closable="false" show-icon></el-alert></el-col>',
            '            </el-row>',
            '            <div class="ai-parser-step-label" style="margin-top:14px;">{{ t(\'ui.aiparser.step3\', \'步驟3：貼上 AI 回覆\') }}</div>',
            '            <el-row :gutter="10">',
            '              <el-col :span="24">',
            '                <el-input type="textarea" :rows="5" v-model="replyText" :placeholder="t(\'ui.aiparser.step3.placeholder\', \'貼上 AI 回覆的 JSON 內容\')"></el-input>',
            '              </el-col>',
            '            </el-row>',
            '            <el-row style="margin-top:10px;">',
            '              <el-col :span="24" class="textcenter">',
            '                <el-button type="success" size="small" :disabled="!replyText.trim()" v-on:click="parseReply">{{ t(\'ui.aiparser.parsebutton\', \'解析回覆\') }}</el-button>',
            '              </el-col>',
            '            </el-row>',
            '            <el-row v-if="errorMsg" style="margin-top:10px;">',
            '              <el-col :span="24"><el-alert type="error" :title="errorMsg" :closable="false" show-icon></el-alert></el-col>',
            '            </el-row>',
            '          </el-tab-pane>',
            '          <el-tab-pane :label="t(\'ui.aiparser.tab.promptpreview\', \'提詞預覽\')" name="prompt">',
            '            <el-input ref="promptTextarea" type="textarea" :rows="18" readonly :value="combinedPrompt" :placeholder="t(\'ui.aiparser.promptpreview.placeholder\', \'提詞預覽（若自動複製失敗，可在此欄位手動全選複製）\')"></el-input>',
            '          </el-tab-pane>',
            '        </el-tabs>',
            '      </div>',
            '    </el-col>',
            '    <el-col :span="14" class="ai-parser-column">',
            '      <div class="ai-parser-column-header">',
            '        <div v-if="groups.length > 0" style="margin-bottom:6px;">',
            '          <span>{{ t(\'ui.aiparser.refinelevel.label\', \'要換算到第幾精鍊：\') }}</span>',
            '          <el-input-number v-model="refineLevel" :min="0" :max="20" :controls="false" size="small" v-on:keyup.enter.native="$event.target.blur()"></el-input-number>',
            '          <span style="margin-left:6px; color:#909399; font-size:12px;">{{ t(\'ui.aiparser.refinelevel.hint\', \'（跟左側同一個設定，調整這裡「每精鍊+N」的效果會即時重算）\') }}</span>',
            '        </div>',
            '        <span v-if="groups.length > 0">{{ tf(\'ui.aiparser.groups.summary\', \'解析出 {total} 個區塊，已勾選 {checked} 個（勾選代表你實際有這個條件，才會套用進裝備）：\', { total: groups.length, checked: checkedGroupCount }) }}</span>',
            '        <span v-else style="color:#909399;">{{ t(\'ui.aiparser.groups.empty\', \'尚未解析出任何區塊，請先在左側貼上說明、複製提詞、把 AI 回覆貼回來後按「解析回覆」。\') }}</span>',
            '      </div>',
            '      <div class="ai-parser-column-scroll">',
            '        <div v-for="(group, gidx) in groups" :key="gidx" style="border:1px solid var(--border-color); border-radius:4px; padding:8px 10px; margin-bottom:8px;">',
            '          <el-row type="flex" align="middle">',
            '            <el-col :span="24">',
            '              <el-checkbox v-model="group.checked"><b>{{ group.name }}</b></el-checkbox>',
            '            </el-col>',
            '          </el-row>',
            '          <el-row v-if="!group.isPrimary && groupHasFormula(group)" style="font-size:12px; color:#909399; margin-top:2px;">',
            '            <el-col :span="24">',
            '              <span v-for="(p, pidx) in group.refineParts" :key="pidx" style="margin-right:10px; white-space:nowrap;">',
            '                {{ p.label }}{{ t(\'ui.aiparser.refinesuffix\', \'精鍊：\') }}<el-input-number v-model="p.value" size="mini" :min="0" :max="20" :controls="false" style="width:55px;" v-on:keyup.enter.native="$event.target.blur()"></el-input-number>',
            '              </span>',
            '            </el-col>',
            '          </el-row>',
            '          <template v-for="item in group.effects">',
            '          <el-row v-if="!item.refineInterval || effectiveValue(item, group) !== 0" :key="item.id + (item.skillName || item.targetName || \'\') + \'_main\'" :gutter="6" type="flex" align="middle" style="min-height:34px;">',
            '            <el-col :span="1"></el-col>',
            '            <template v-if="item.targeted && !item.confirmed">',
            '              <el-col :span="6"><span class="EffectType" :class="effectTagClass(item.id)">{{ t(item.id, item.label) }}</span></el-col>',
            '              <el-col :span="3">{{ effectiveValue(item, group) }}{{ item.suffixsymbol }}</el-col>',
            '              <el-col :span="11">',
            '                <el-select v-model="item.targetId" filterable size="small" :placeholder="t(\'ui.aiparser.searchoption.placeholder\', \'搜尋選項\')" style="width:100%;">',
            '                  <el-option v-for="opt in targetOptionsFor(item)" :key="opt.id" :label="opt.name" :value="opt.id"></el-option>',
            '                </el-select>',
            '              </el-col>',
            '              <el-col :span="3"><el-button size="mini" type="warning" :disabled="!item.targetId" v-on:click="onConfirmTargetPick(item)">{{ t(\'ui.common.apply\', \'套用\') }}</el-button></el-col>',
            '            </template>',
            '            <template v-else-if="item.targeted">',
            '              <el-col :span="9"><span class="EffectType" :class="effectTagClass(item.id)">{{ t(item.id, item.label) }}</span>：{{ resolvedTargetName(item) }}</el-col>',
            '              <el-col :span="2">{{ item.opersymbol }}</el-col>',
            '              <el-col :span="8">{{ effectiveValue(item, group) }}</el-col>',
            '              <el-col :span="4">{{ item.suffixsymbol }}</el-col>',
            '            </template>',
            '            <template v-else-if="item.refineInterval">',
            '              <el-col :span="9"><span class="EffectType" :class="effectTagClass(item.id)">{{ t(item.id, item.label) }}</span></el-col>',
            '              <el-col :span="2">{{ item.opersymbol }}</el-col>',
            '              <el-col :span="8"><b>{{ effectiveValue(item, group) }}</b></el-col>',
            '              <el-col :span="4">{{ item.suffixsymbol }}</el-col>',
            '            </template>',
            '            <template v-else>',
            '              <el-col :span="9"><span class="EffectType" :class="effectTagClass(item.id)">{{ t(item.id, item.label) }}</span></el-col>',
            '              <el-col :span="2">{{ item.opersymbol }}</el-col>',
            '              <el-col :span="8"><el-input-number v-model="item.value" size="small" :precision="2" :controls="false" style="width:100%;"></el-input-number></el-col>',
            '              <el-col :span="4">{{ item.suffixsymbol }}</el-col>',
            '            </template>',
            '          </el-row>',
            '          </template>',
            '        </div>',
            '        <div v-if="mergedPreview.length > 0" class="bg-purple-light" style="margin-top:6px; padding:8px 10px; border-radius:4px;">',
            '          <div style="margin-bottom:4px;"><b>{{ t(\'ui.aiparser.mergedpreview.title\', \'套用後加總預覽（勾選區塊相同效果會加總成一筆寫入裝備）：\') }}</b></div>',
            '          <el-row v-for="item in mergedPreview" :key="item.id" :gutter="6" type="flex" align="middle" style="height:30px;">',
            '            <el-col :span="10"><span class="EffectType" :class="effectTagClass(item.id)">{{ t(item.id, item.label) }}</span></el-col>',
            '            <el-col :span="2">{{ item.opersymbol }}</el-col>',
            '            <el-col :span="8">{{ item.value }}</el-col>',
            '            <el-col :span="4">{{ item.suffixsymbol }}</el-col>',
            '          </el-row>',
            '        </div>',
            '        <div v-if="mergedTargetedPreview.length > 0" class="bg-purple-light2" style="margin-top:6px; padding:8px 10px; border-radius:4px;">',
            '          <div style="margin-bottom:4px;"><b>{{ t(\'ui.aiparser.targetedpreview.title\', \'指定對象效果加總預覽（技能/種族/體型/階級/屬性，按上方「套用」時一起寫入裝備）：\') }}</b></div>',
            '          <el-row v-for="row in mergedTargetedPreview" :key="row.key" :gutter="6" type="flex" align="middle" style="height:30px;">',
            '            <el-col :span="10"><span class="EffectType" :class="effectTagClass(row.id)">{{ t(row.id, row.label) }}</span>：{{ row.targetName }}</el-col>',
            '            <el-col :span="2">{{ row.opersymbol }}</el-col>',
            '            <el-col :span="8">{{ row.value }}{{ row.suffixsymbol }}</el-col>',
            '          </el-row>',
            '        </div>',
            '      </div>',
            '    </el-col>',
            '  </el-row>',
            '</el-dialog>',
        ].join('\n'),
    });
})(typeof window !== 'undefined' ? window : this);
