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
 * 解析方向是「效果優先」：AI先把說明文字裡每一條效果都找出來，條件相同的效果放成一個區塊，
 * 再把該區塊成立需要的所有條件列成標籤（conditions:[{type,text,min}]）——條件只是給使用者看的
 * 標籤，不管多複雜、AI分不出類型（type:'other'）都不會讓效果消失；計算機沒有對應詞條的效果
 * 也會以 {id:null,text} 保留成唯讀的「無對應詞條」項目。只有「這件裝備自己的精鍊門檻」
 * （type:'refine' 帶 min）程式會自動判斷勾選，其餘條件一律預設不勾、由使用者自己勾。
 *
 * 每個區塊可以整塊勾選/取消（而不是每條效果分開勾），也能個別修正數值，
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
 * 另外 BypassDEFPercent（無視物理防禦%）/BypassMDEFPercent（無視魔法防禦%）比較特殊——這兩個id
 * 不像上面那組「一個id固定對應一種分類（種族or階級or體型or屬性）」，而是同一個id可能被「種族」
 * 或「階級」其中一種targetId指定（例如「對惡魔無視防禦+20%」是種族、「對首領無視防禦+15%」是
 * 階級），所以猜測/顯示時要靠targetId本身的前綴（race:/level:）判斷屬於哪個分類，不能像其他
 * id一樣直接從id反查出唯一分類（見 MULTI_TARGET_CATEGORIES / getCategoryFromTargetId）。
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

    // BypassDEFPercent/BypassMDEFPercent 比較特殊：不是「一個id固定對應一種分類」，而是同一個id
    // 可能被「種族」或「階級」其中一種targetId指定（兩種分類共用同一個id），所以用id查不出唯一
    // 分類，只能列出「這個id可能屬於哪些分類」，實際是哪一種要等targetId猜出來後才知道
    // （見 getCategoryFromTargetId：直接看targetId本身的前綴，不是看id）。
    // 不屬於上面 atk/matk 成對結構、但一樣用 'element:' targetId 指定單一屬性的 id：
    // ElementalMagicPercent（屬性魔法%：「風屬性魔法傷害+X%」＝自己施放的該屬性魔法增傷，看的是
    // 技能屬性，不是怪物屬性）、ElementDamageDealtIncreasedPercent（屬性耐性減少%）。
    // 計算機主程式本來就支援它們帶 element targetId（見 index.html getDetailRows 的 targetKind:'element'）。
    var EXTRA_CATEGORY_IDS = {
        ElementalMagicPercent: 'element',
        ElementDamageDealtIncreasedPercent: 'element',
    };

    // AI給的種族/體型/階級/屬性名稱常常跟計算機選單的寫法不同（BOSS vs 首領、闇 vs 暗、英文說明…），
    // 比對前先把這些別名換成選單上的正式名稱（不分大小寫、長的別名優先替換，避免 human 先吃掉 demi-human）。
    var CATEGORY_ALIASES = {
        level: { 'boss': '首領', 'mvp': '首領', '頭目': '首領', '王': '首領', '普通': '一般', 'normal': '一般' },
        element: { '闇': '暗', 'neutral': '無', 'fire': '火', 'water': '水', 'wind': '風', 'earth': '地', 'poison': '毒', 'holy': '聖', 'shadow': '暗', 'dark': '暗', 'ghost': '念', 'undead': '不死' },
        race: { '魚類': '魚貝', 'fish': '魚貝', 'formless': '無形', 'undead': '不死', 'brute': '動物', 'animal': '動物', 'plant': '植物', 'insect': '昆蟲', 'demon': '惡魔', 'demi-human': '人形', 'demihuman': '人形', 'demi human': '人形', 'angel': '天使', 'dragon': '龍族' },
        size: { 'small': '小型', 'medium': '中型', 'large': '大型' },
    };

    var MULTI_TARGET_CATEGORIES = {
        BypassDEFPercent: ['race', 'level'],
        BypassMDEFPercent: ['race', 'level'],
    };

    // 依部位暫存的「步驟1裝備說明」跟「步驟3 AI回覆」文字：{ [partIndex]: { description, replyText } }。
    // 故意放在元件外面（module級別，不是元件的data）：對話框是 v-if 控制的，每次關掉再打開都是全新的
    // 元件實體，如果存在元件自己的data裡，關掉對話框就會整個消失——現在改放這裡，只要頁面沒重新整理，
    // 不管對話框開了幾次、從裝備編輯頁的按鈕開還是從主畫面裝備區塊的按鈕開，同一個部位之前存過的內容
    // 都還在。只存這兩段文字（不存解析出來的groups）；重新整理頁面就會消失，只是「暫時」不是永久保存。
    var partDraftStore = {};

    // AI回覆裡每個區塊 conditions[].type 的合法值（見 buildPrompt）。只有 'refine'（這件裝備自己的
    // 精鍊門檻，帶 min）會被程式自動判斷勾選，其餘全部只是顯示用的標籤，由使用者自己勾。
    var CONDITION_TYPES = ['refine', 'set', 'grade', 'job', 'stat', 'refineOther', 'other'];

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
                        if (e.targeted || e.unmapped) return;
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
            // 精鍊一改，只有條件全是「自身精鍊門檻」、而且使用者沒手動點過的區塊會自動重新判斷勾選。
            refineLevel: function () {
                var self = this;
                this.groups.forEach(function (g) {
                    if (g.autoCheck && !g.manual) g.checked = self.conditionsMet(g);
                });
            },
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
                    '以下是一件裝備的英文或中文說明文字。請用「效果優先」的方式解析：先把說明文字裡「每一條效果」都找出來，再替每條效果標記它成立需要的條件。',
                    '重點：條件只是「標籤」，不管條件多複雜、多少層、你看不看得懂，效果都一定要列出來，絕對不可以因為條件判斷不了就把效果丟掉，也不要把條件不同的效果合併在一起。使用者會自己看條件決定要不要勾選。',
                    '',
                    '輸出規則：',
                    '- 依照說明文字由上到下的順序，輸出一個個「效果區塊」。一個區塊 = 一組「條件完全相同」的效果。同一句話裡多個效果條件相同就放同一區塊；條件只要有一點不同（門檻數字不同、搭配的裝備不同、階級不同…）就要拆成不同區塊。',
                    '- 每個區塊的 "source" 填這個區塊對應的說明文字原文（照抄原句、保留原文語言），讓使用者對照。',
                    '- 每個區塊的 "conditions" 是陣列，列出這個區塊成立需要「同時」滿足的所有條件。沒有任何條件（裝備上就一直生效）就給空陣列 []。',
                    '- 條件是巢狀的也要全部展開列出：例如在「[D階級]」標題底下的「精鍊+9以上時…」，conditions 要同時列出 [D階級] 跟 精鍊9以上 兩個條件；例如「搭配「A」時，若精鍊+10以上，再增加…」要同時列出「搭配A」跟「精鍊10以上」。',
                    '- 每個條件是物件 {"type": 類型, "text": "給使用者看的簡短條件描述（沿用原文用語）"}，type 只能是下面其中一個：',
                    '  "refine"：這件裝備「自己」的精鍊達到某個門檻（例如「精鍊+7以上」「精鍊達到+9時」）。這種必須額外加 "min": 門檻數字（整數）。',
                    '  "set"：搭配某件指定裝備/卡片才生效（套裝效果）。',
                    '  "grade"：依「裝備自身」的階級，例如 [D階級][C階級][B階級][A階級]。',
                    '  "job"：依「裝備者角色」的職業/職業系列，例如「裝備者為妖術師系列時」。（注意跟 grade 不同：grade 是裝備的階級，job 是角色的職業）',
                    '  "stat"：角色自身數值門檻，例如「基本STR 120以上」「特性素質SPL、WIS總和150以上」「Base Lv 達到…」。',
                    '  "refineOther"：「其他部位」（不是這件裝備本身）的精鍊門檻，例如「披肩精鍊+9以上」「披肩、鎧甲精鍊合計+18以上」。',
                    '  "other"：任何不屬於上面類型、或你不確定是哪一類的條件（例如學會某技能時、使用某技能後一段時間內、特定地圖…）。不確定就用 other，text 寫清楚原文條件即可。',
                    '',
                    '效果數值規則：',
                    '- 「每 +N 精鍊，效果 +M」這種規律遞增（例如「每精鍊+3，OO傷害+4%」），不要自己代入精鍊算好最終數字，而是輸出 {"id":..., "value": 跟精鍊規律無關的固定部分（沒有就填0）, "refineInterval": N, "refineStep": M}，程式會依使用者輸入的精鍊即時計算。這種「每+N」本身不算條件，不要因此另外加 refine 條件。',
                    '- 如果「每 +N 精鍊」指的是「其他部位」的精鍊（例如編輯的是衣服，但寫「披肩精鍊每+2…」或「披肩、鎧甲精鍊合計每+6…」），一樣輸出 refineInterval/refineStep，並在「區塊」物件上額外加 "refineParts": 部位名稱字串陣列（例如 ["披肩"] 或 ["披肩","鎧甲"]）。依據這件裝備自己精鍊的就不要加 refineParts。',
                    '- 「精鍊+7時+3%、精鍊+9時再+2%」這種門檻：每個門檻各自是一個區塊，各自帶 {"type":"refine","min":門檻} 條件，value 只填該門檻那一句「自己寫的數字」，不要幫忙跟其他門檻累加（程式會把所有達到門檻的區塊自動加總）。',
                    '- 百分比欄位請填數字本身（例如7%要填7，不要填0.07）。',
                    '',
                    '詞條 id：每條效果盡量對應到下面清單裡的 id，不能自己發明新的 id。清單裡每個項目的 opersymbol 是這個欄位在畫面上顯示的正負號慣例：',
                    'opersymbol 為 "-" 代表這個欄位平常語意是「減少/縮短」某個量（例如可變詠唱時間、攻擊後硬直%、CD、固定詠唱時間都是這種）。',
                    '如果裝備效果是「縮短/減少」該數值，請填正數；如果裝備效果反而是「拉長/增加」該數值（等於是懲罰、負面效果），請填負數。',
                    'opersymbol 為 "+" 的欄位則相反：正常增益填正數，若是懲罰、負面效果則填負數。',
                    '',
                    JSON.stringify(typeList),
                    '',
                    '清單裡找不到對應 id 的效果（例如攻擊距離、機率自動施放技能、移動速度…）仍然要列出來，不要忽略：輸出 {"id": null, "text": "該效果的原文"}，放在它所屬的區塊裡（條件照樣標記），使用者會看到這條效果，但知道它無法自動套用。',
                    '',
                    '特別規則：「SkillDamagePercent」（技能增傷 %）和「CDTime」（技能獨延）這兩個 id，計算機這邊沒有把完整的技能清單給你，所以你不需要、也不應該猜測或編造技能的內部代碼。',
                    '如果說明文字裡這兩種效果是指定「某一個特定技能」才生效（例如「毀滅彗星的傷害+7%」「××技能冷卻時間-20秒」），除了照常填 id 和 value，另外加一個 "skillName" 欄位，內容是說明文字裡寫的技能原始名稱（保留原文語言、不要翻譯）；如果是「所有技能」都適用，則不要加 skillName 欄位。同一條效果同時指定好幾個技能時，每個技能各自拆成一筆效果（id、value 相同，skillName 各填一個）。',
                    '',
                    '特別規則：「對全種族/全體型/全屬性/全階級（或特定怪物）對象的傷害」這種依對象分類的加成，清單裡「物理」跟「魔法」是兩個完全獨立的 id：種族用 RaceAtkPercent（物理）/RaceMatkPercent（魔法），體型用 SizeAtkPercent（物理）/SizeMatkPercent（魔法），屬性用 ElementalAtkPercent（物理）/ElementalMatkPercent（魔法），階級用 LevelAtkPercent（物理）/LevelMatkPercent（魔法），特定怪物用 MonsterAtkPercent（物理）/MonsterMatkPercent（魔法）。',
                    '如果說明文字寫的是「物理和魔法傷害都+X%」，請把物理跟魔法兩個 id 都輸出，各自一筆；如果文字只提到其中一種，就只輸出對應的那一個 id。',
                    '如果說明文字指定的是「特定」種族/體型/階級/屬性才生效（例如「對惡魔種族傷害+10%」「對中型怪物傷害+15%」「對BOSS級怪物傷害+20%」「對火屬性怪物傷害+8%」），除了照常填 id 和 value，另外加一個 "targetName" 欄位，內容是原文寫的種族/體型/階級/屬性名稱（例如「惡魔」「中型」「BOSS」「火」），不要猜測或編造內部代碼。如果是「全部」種族/體型/階級/屬性都適用，則不要加 targetName。',
                    '同一條效果同時指定好幾個特定目標（例如「對中、大型對象的魔法傷害+30%」），請把每個目標各自拆成一筆效果（id、value 相同，targetName 各填一個）。',
                    '注意：「對某種族/體型/屬性/階級的怪物」是效果的「對象」，用 targetName 表示，不是條件，不要放進 conditions。',
                    '',
                    '特別規則（屬性相關，務必分清楚）：「XX屬性魔法傷害+N%」（例如「風屬性魔法傷害+10%」「風/念屬性魔法傷害+8%」）指的是「自己施放的該屬性魔法」增傷，看的是技能本身的屬性，請用 ElementalMagicPercent；「對XX屬性對象的魔法傷害+N%」（有「對…對象/敵人/怪物」字樣）指的是打「該屬性的怪物」，才用 ElementalMatkPercent（物理版是 ElementalAtkPercent）。',
                    'ElementalMagicPercent 也要依屬性加 targetName：指定特定屬性時 targetName 填屬性名稱（例如「風」「念」）；寫好幾個屬性（例如「風/念屬性魔法傷害+8%」）就每個屬性各拆一筆（id、value 相同，targetName 各填一個）；只有寫「全屬性魔法傷害」這種所有屬性都適用時才不加 targetName。',
                    '「屬性耐性減少」(ElementDamageDealtIncreasedPercent) 若指定特定屬性，同樣加 targetName 填屬性名稱。',
                    '',
                    '特別規則：「BypassDEFPercent」（無視物理防禦%）和「BypassMDEFPercent」（無視魔法防禦%）通常對「全部」目標都適用，但也可能只對「特定種族」或「特定階級（例如BOSS/首領級、一般怪）」才無視防禦。如果明確指定特定種族或特定階級，加 "targetName" 填該種族或階級的原始名稱（例如「惡魔」「首領」）；對所有目標都適用就不要加 targetName。',
                    '',
                    '特別規則（容易混淆，務必分清楚）：「BypassDEFPercent/BypassMDEFPercent」（無視物理/魔法「防禦」，也就是傳統的DEF/MDEF）跟「BypassRESPercent/BypassMRESPercent」（無視「RES/MRES」）是完全不同的兩組數值：',
                    '- 說明文字裡只要出現「防禦」「DEF」「MDEF」字樣（例如「無視防禦」「無視魔法防禦」），一律對應 BypassDEFPercent（物理）或 BypassMDEFPercent（魔法）。',
                    '- 只有說明文字明確寫出「RES」或「MRES」這個縮寫字樣本身時，才對應 BypassRESPercent/BypassMRESPercent。',
                    '- 「全階級」「所有階級」「不分階級」代表一般怪+首領/BOSS怪都適用，不要加 targetName。',
                    '',
                    '只回傳一個 JSON 物件，不要有任何說明文字、不要用 ```json 這種標記包起來。格式範例（用不到的選填欄位不要輸出；範例中的 "..." 要換成清單裡正確的 id）：',
                    '{"blocks": [',
                    '  {"source": "ATK+10%。", "conditions": [], "effects": [{"id": "AtkPercent", "value": 10}]},',
                    '  {"source": "每精鍊+2，ATK+5。", "conditions": [], "effects": [{"id": "Atk", "value": 0, "refineInterval": 2, "refineStep": 5}]},',
                    '  {"source": "精鍊+9以上時，遠距離物理傷害+5%。", "conditions": [{"type": "refine", "min": 9, "text": "精鍊+9以上"}], "effects": [{"id": "...", "value": 5}]},',
                    '  {"source": "[C階級] 搭配「某某披肩」時，物理攻擊時有機率發動XX，對惡魔種族的物理傷害+10%。", "conditions": [{"type": "grade", "text": "[C階級]"}, {"type": "set", "text": "搭配「某某披肩」"}], "effects": [{"id": null, "text": "物理攻擊時有機率發動XX"}, {"id": "RaceAtkPercent", "value": 10, "targetName": "惡魔"}]},',
                    '  {"source": "披肩精鍊每+2，ASPD+1%。", "refineParts": ["披肩"], "conditions": [], "effects": [{"id": "...", "value": 0, "refineInterval": 2, "refineStep": 1}]}',
                    ']}',
                ].join('\n');
            },
            // SkillDamagePercent（技能增傷%）/CDTime（技能獨延）這兩個id在計算機裡是「所有技能」跟
            // 「指定某個技能」共用同一個id、用targetId區分——AI沒有完整技能清單無法可靠猜出技能內部代碼，
            // 所以這兩個id一律不給數字輸入框，改成從完整技能清單（skillOptions，不限職業）挑選。
            isSkillTargetId: function (id) {
                return id === 'SkillDamagePercent' || id === 'CDTime';
            },
            // 回傳這個id屬於哪個「指定對象」分類（'race'/'size'/'level'/'element'），不是就回傳null。
            // 注意：BypassDEFPercent/BypassMDEFPercent不會從這裡查到分類（它們可能是race也可能是
            // level，一個id查不出唯一分類），要用 getMultiCategoriesForId / getCategoryFromTargetId。
            getCategoryForId: function (id) {
                for (var key in TARGET_CATEGORIES) {
                    if (TARGET_CATEGORIES[key].atk === id || TARGET_CATEGORIES[key].matk === id) return key;
                }
                return EXTRA_CATEGORY_IDS[id] || null;
            },
            // BypassDEFPercent/BypassMDEFPercent這種「一個id可能屬於好幾種分類」的清單，不是就回傳null。
            getMultiCategoriesForId: function (id) {
                return MULTI_TARGET_CATEGORIES[id] || null;
            },
            // 直接看targetId本身的前綴（race:/level:/...）判斷屬於哪個分類——跟getCategoryForId
            // （從id反查）互補：id唯一對應分類的效果兩種查法結果一樣，但BypassDEFPercent這種
            // 「一個id可能是好幾種分類」的效果，只有這個方法查得出「這一筆實際」是哪一種。
            getCategoryFromTargetId: function (targetId) {
                if (!targetId) return null;
                for (var key in TARGET_CATEGORIES) {
                    if (targetId.indexOf(TARGET_CATEGORIES[key].prefix) === 0) return key;
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
                var aliases = CATEGORY_ALIASES[category] || {};
                Object.keys(aliases).sort(function (a, b) { return b.length - a.length; }).forEach(function (k) {
                    if (name.indexOf(k) > -1) name = name.split(k).join(aliases[k]);
                });
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
            // BypassDEFPercent/BypassMDEFPercent這種「一個id可能是好幾種分類」的效果，選單要把
            // 每個可能分類的清單都串在一起（例如種族+階級兩份都列出來），讓使用者自己選是哪一種。
            targetOptionsFor: function (item) {
                if (this.isSkillTargetId(item.id)) return this.skillOptions;
                var self = this;
                var multiCategories = this.getMultiCategoriesForId(item.id);
                if (multiCategories) {
                    var opts = [];
                    multiCategories.forEach(function (cat) {
                        var prefix = TARGET_CATEGORIES[cat].prefix;
                        opts = opts.concat(self.getCategoryOptions(cat).map(function (o) { return { id: prefix + o.id, name: o.name }; }));
                    });
                    return opts;
                }
                var category = this.getCategoryForId(item.id);
                if (category) {
                    var prefix = TARGET_CATEGORIES[category].prefix;
                    return this.getCategoryOptions(category).map(function (o) { return { id: prefix + o.id, name: o.name }; });
                }
                return [];
            },
            // 已確認效果只存了targetId，這裡查回可讀名稱顯示在畫面上——技能查skillOptions；
            // 種族/體型/階級/屬性則靠targetId本身的前綴（而不是item.id）判斷屬於哪個分類再查對應
            // 清單，這樣同時涵蓋「id唯一對應分類」跟「一個id可能是好幾種分類」（BypassDEFPercent
            // 之類）兩種情形，不用另外分支處理。
            resolvedTargetName: function (item) {
                if (this.isSkillTargetId(item.id)) return this.skillTargetName(item);
                if (!item.targetId) return item.targetId;
                var category = this.getCategoryFromTargetId(item.targetId);
                if (category) {
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
            // 把AI給的條件陣列整理成固定格式 [{type, text, min}]；type不認得的一律當 other，
            // 純字串的條件也接受（當成 other），不會因為格式小差異就整個區塊壞掉。
            normalizeConditions: function (raw) {
                if (!Array.isArray(raw)) return [];
                return raw.map(function (c) {
                    if (typeof c === 'string') return { type: 'other', text: c, min: null };
                    if (!c || typeof c !== 'object') return null;
                    var type = CONDITION_TYPES.indexOf(c.type) > -1 ? c.type : 'other';
                    var min = (c.min !== undefined && c.min !== null && !isNaN(Number(c.min))) ? Number(c.min) : null;
                    var text = (typeof c.text === 'string' && c.text.trim()) ? c.text.trim()
                        : (type === 'refine' && min !== null ? ('+' + min) : '');
                    if (!text && min === null) return null;
                    return { type: type, text: text, min: min };
                }).filter(function (c) { return !!c; });
            },
            // 只判斷程式能判斷的條件（這件裝備自己的精鍊門檻）；給 autoCheck 區塊用。
            conditionsMet: function (group) {
                var refine = this.refineLevel;
                return group.conditions.every(function (c) {
                    return c.type === 'refine' && c.min !== null ? refine >= c.min : false;
                });
            },
            onGroupToggle: function (group) {
                group.manual = true;
            },
            conditionTypeLabel: function (type) {
                var map = {
                    refine: this.t('ui.aiparser.cond.refine', '精鍊'),
                    set: this.t('ui.aiparser.cond.set', '套裝'),
                    grade: this.t('ui.aiparser.cond.grade', '階級'),
                    job: this.t('ui.aiparser.cond.job', '職業'),
                    stat: this.t('ui.aiparser.cond.stat', '素質'),
                    refineOther: this.t('ui.aiparser.cond.refineother', '其他部位精鍊'),
                    other: this.t('ui.aiparser.cond.other', '其他'),
                };
                return map[type] || map.other;
            },
            conditionTagType: function (cond) {
                if (cond.type === 'refine') return this.refineLevel >= cond.min ? 'success' : 'info';
                if (cond.type === 'set') return 'warning';
                if (cond.type === 'grade' || cond.type === 'job') return '';
                return 'danger';
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
                    if (group && group.refineParts && group.refineParts.length > 0) {
                        refine = group.refineParts.reduce(function (sum, p) { return sum + (Number(p.value) || 0); }, 0);
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

                // 新格式是 {blocks:[...]}（效果優先：每個區塊=一組條件相同的效果，條件只是標籤）；
                // 舊格式 {groups:[...]}（以條件分類為主）也照樣吃，舊的回覆貼回來不會壞。
                var rawGroups = parsed && Array.isArray(parsed.blocks) ? parsed.blocks
                    : (parsed && Array.isArray(parsed.groups) ? parsed.groups : null);
                if (!rawGroups) {
                    this.errorMsg = this.t('ui.aiparser.error.badformat', '貼上的 JSON 格式不是預期的 {blocks:[...]}');
                    return;
                }

                var typeMap = {};
                this.effectTypeList.forEach(function (t) { typeMap[t.id] = t; });

                var unknownIds = []; // 記錄回覆裡有但我們清單裡沒有的id，方便診斷
                this.groups = rawGroups.map(function (g, idx) {
                    g = g || {};
                    var effects = (Array.isArray(g.effects) ? g.effects : [])
                        .filter(function (row) {
                            if (!row) return false;
                            // 計算機沒有對應詞條的效果（AI給 id:null + text，或給了我們不認得的id）不丟掉，
                            // 保留成「無法自動套用」的唯讀項目顯示出來，讓使用者知道這條效果存在。
                            if (!typeMap[row.id]) {
                                if (row.id) unknownIds.push(row.id);
                                return !!(row.text || row.id);
                            }
                            var hasFormula = Number(row.refineInterval) > 0 && !isNaN(Number(row.refineStep)) && Number(row.refineStep) !== 0;
                            return hasFormula || (Number(row.value) !== 0 && !isNaN(Number(row.value)));
                        })
                        .map(function (row) {
                            if (!typeMap[row.id]) {
                                return { unmapped: true, id: row.id || '', text: String(row.text || row.id) };
                            }
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
                            // BypassDEFPercent/BypassMDEFPercent：一個id可能是「種族」或「階級」其中
                            // 一種，getCategoryForId(單一分類)查不出來，要另外查multiCategories清單。
                            var multiCategories = self.isSkillTargetId(row.id) ? null : self.getMultiCategoriesForId(row.id);
                            var isSkillKind = self.isSkillTargetId(row.id) && !!skillName;
                            var isCategoryKind = (!!category || !!multiCategories) && !!targetName;
                            var targeted = isSkillKind || isCategoryKind;
                            var guessedTargetId = '';
                            if (isSkillKind) {
                                guessedTargetId = self.guessSkillId(skillName);
                            } else if (multiCategories) {
                                // 依序試每個可能分類，猜到哪個算哪個（種族/階級名稱不會重疊，正常不會兩個都猜到）。
                                for (var mi = 0; mi < multiCategories.length && !guessedTargetId; mi++) {
                                    guessedTargetId = self.guessCategoryTargetId(multiCategories[mi], targetName);
                                }
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
                    // refineParts：「每+N精鍊」規律依據的是「其他部位」的精鍊時，AI會在區塊上列出部位名稱
                    // （例如["披肩","鎧甲"]），每個部位各一個輸入框，程式自動加總。沒列就代表依據這件
                    // 裝備自己的精鍊，直接用最上面的 refineLevel（見 effectiveValue）。
                    var refineParts = [];
                    if (hasFormulaEffect && Array.isArray(g.refineParts)) {
                        refineParts = g.refineParts
                            .filter(function (s) { return typeof s === 'string' && s.trim(); })
                            .map(function (label) { return { label: label, value: self.refineLevel }; });
                    }
                    var conditions = self.normalizeConditions(g.conditions);
                    // 條件全部都是「這件裝備自己的精鍊門檻」（或根本沒條件）→ 程式可以自己判斷要不要勾，
                    // 之後調整精鍊會自動重新勾選/取消；只要有任何一個程式判斷不了的條件（套裝/階級/職業/
                    // 素質/其他…）就預設不勾，交給使用者自己決定。
                    var autoCheck = conditions.every(function (c) { return c.type === 'refine' && c.min !== null; });
                    var group = {
                        source: (typeof g.source === 'string' && g.source.trim()) ? g.source.trim() : '',
                        name: g.name || self.tf('ui.aiparser.group.fallbackname', '區塊 {n}', { n: idx + 1 }),
                        conditions: conditions,
                        autoCheck: autoCheck,
                        // 使用者手動點過勾選框之後，調整精鍊就不再自動改它的勾選狀態
                        manual: false,
                        checked: false,
                        refineParts: refineParts,
                        effects: effects,
                    };
                    group.checked = autoCheck ? self.conditionsMet(group) : false;
                    return group;
                }).filter(function (g) { return g.effects.length > 0; });

                if (!this.groups.some(function (g) { return g.effects.some(function (e) { return !e.unmapped; }); })) {
                    console.log('[ai_equip_parser] unmatched ids from reply:', unknownIds);
                    this.errorMsg = unknownIds.length > 0
                        ? this.tf('ui.aiparser.error.unknownids', '沒有解析出任何已知效果。回覆裡有計算機不認得的id：{ids}（按F12打開主控台可看到完整清單）', { ids: unknownIds.slice(0, 10).join(', ') })
                        : this.t('ui.aiparser.error.noeffects', '沒有解析出任何已知效果，請確認貼上的 JSON 內容是否正確');
                }
            },
            applyResults: function () {
                var self = this;
                // 從主畫面按鈕開啟、還沒選部位時，沒有地方可以寫入，先請使用者選部位。
                if (this.currentPartIndex === '' || this.currentPartIndex === null || this.currentPartIndex === undefined) {
                    this.errorMsg = this.t('ui.aiparser.error.nopart', '請先在步驟1選擇要套用到哪個部位');
                    return;
                }
                var sums = {};
                this.groups.filter(function (g) { return g.checked; }).forEach(function (g) {
                    g.effects.forEach(function (e) {
                        if (e.targeted || e.unmapped) return;
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
                // 全部效果都送出後通知父層：若裝備編輯視窗沒開（從主畫面開的），父層要自己把暫存寫回部位。
                this.$emit('apply-done', this.currentPartIndex);
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
            '<el-dialog :visible.sync="dialogVisible" custom-class="Dialogue-container" width="80%" top="50px" center :close-on-click-modal="false" v-on:close="onClose">',
            '  <span slot="title">{{ t(\'ui.aiparser.title\', \'AI 裝備效果解析\') }} <b v-if="equipLabel">{{ equipLabel }}</b></span>',
            '  <el-row type="flex" justify="end" :gutter="10" class="ai-parser-actions-row">',
            '    <el-col :span="4"><el-button size="small" v-on:click="dialogVisible = false">{{ t(\'ui.common.cancel\', \'取消\') }}</el-button></el-col>',
            '    <el-col :span="4"><el-button type="success" size="small" :disabled="checkedGroupCount === 0" v-on:click="applyResults">{{ tf(\'ui.aiparser.applyblocks\', \'套用（{n} 區塊）\', { n: checkedGroupCount }) }}</el-button></el-col>',
            '  </el-row>',
            '  <el-row :gutter="14" type="flex" class="ai-parser-columns-row">',
            '    <el-col :span="8" class="ai-parser-column">',
            '      <div class="ai-parser-column-scroll themed-scrollbar">',
            '        <el-tabs v-model="activeLeftTab" class="ai-parser-tabs">',
            '          <el-tab-pane :label="t(\'ui.aiparser.tab.main\', \'裝備說明與解析\')" name="main">',
            '            <div style="color:#909399; font-size:12px; margin-bottom:6px;">{{ t(\'ui.aiparser.recommendedsites\', \'推薦資料站\') }}：<a href="https://rd.fharr.com/" target="_blank" rel="noopener noreferrer">fharr</a>、<a href="https://www.divine-pride.net/database/item" target="_blank" rel="noopener noreferrer">divine-pride</a></div>',
            '            <div class="ai-parser-step-label">{{ t(\'ui.aiparser.step1\', \'步驟1：選擇部位／精鍊\') }}</div>',
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
            '            <div class="ai-parser-step-label" style="margin-top:10px;">{{ t(\'ui.aiparser.step2\', \'步驟2：貼上裝備說明，並複製到任何 AI Chat\') }}<span style="font-weight:normal; color:#909399; font-size:12px; margin-left:4px;">（{{ t(\'ui.aiparser.step2.hint.prefix\', \'例如\') }} <a href="https://chatgpt.com" target="_blank" rel="noopener noreferrer">ChatGPT</a>、<a href="https://gemini.google.com" target="_blank" rel="noopener noreferrer">Gemini</a>、<a href="https://claude.ai" target="_blank" rel="noopener noreferrer">Claude</a> {{ t(\'ui.aiparser.step2.hint.suffix\', \'等皆可\') }}）</span></div>',
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
            '    <el-col :span="9" class="ai-parser-column">',
            '      <div class="ai-parser-column-header">',
            '        <div v-if="groups.length > 0" style="margin-bottom:6px;">',
            '          <span>{{ t(\'ui.aiparser.refinelevel.label\', \'要換算到第幾精鍊：\') }}</span>',
            '          <el-input-number v-model="refineLevel" :min="0" :max="20" :controls="false" size="small" v-on:keyup.enter.native="$event.target.blur()"></el-input-number>',
            '          <span style="margin-left:6px; color:#909399; font-size:12px;">{{ t(\'ui.aiparser.refinelevel.hint\', \'（跟左側同一個設定，調整這裡「每精鍊+N」的效果會即時重算）\') }}</span>',
            '        </div>',
            '        <span v-if="groups.length > 0">{{ tf(\'ui.aiparser.groups.summary\', \'解析出 {total} 個區塊，已勾選 {checked} 個（勾選代表你實際有這個條件，才會套用進裝備）：\', { total: groups.length, checked: checkedGroupCount }) }}</span>',
            '        <span v-else style="color:#909399;">{{ t(\'ui.aiparser.groups.empty\', \'尚未解析出任何區塊，請先在左側貼上說明、複製提詞、把 AI 回覆貼回來後按「解析回覆」。\') }}</span>',
            '      </div>',
            '      <div class="ai-parser-column-scroll themed-scrollbar">',
            '        <div v-for="(group, gidx) in groups" :key="gidx" class="ai-parser-block" :class="{ \'is-unchecked\': !group.checked }">',
            '          <div class="ai-parser-block-head">',
            '            <el-checkbox v-model="group.checked" v-on:change="onGroupToggle(group)"></el-checkbox>',
            '            <div class="ai-parser-block-conds">',
            '              <el-tag v-if="group.conditions.length === 0" size="mini" type="success">{{ t(\'ui.aiparser.cond.none\', \'無條件\') }}</el-tag>',
            '              <el-tag v-for="(c, cidx) in group.conditions" :key="cidx" size="mini" :type="conditionTagType(c)">{{ conditionTypeLabel(c.type) }}｜{{ c.text }}</el-tag>',
            '            </div>',
            '          </div>',
            '          <div class="ai-parser-block-source">{{ group.source || group.name }}</div>',
            '          <el-row v-if="group.refineParts.length > 0" style="font-size:12px; color:#909399; margin-top:2px;">',
            '            <el-col :span="24">',
            '              <span v-for="(p, pidx) in group.refineParts" :key="pidx" style="margin-right:10px; white-space:nowrap;">',
            '                {{ p.label }}{{ t(\'ui.aiparser.refinesuffix\', \'精鍊：\') }}<el-input-number v-model="p.value" size="mini" :min="0" :max="20" :controls="false" style="width:55px;" v-on:keyup.enter.native="$event.target.blur()"></el-input-number>',
            '              </span>',
            '            </el-col>',
            '          </el-row>',
            '          <template v-for="(item, eidx) in group.effects">',
            '          <el-row v-if="item.unmapped" :key="\'u\' + eidx" :gutter="6" type="flex" align="middle" class="ai-parser-unmapped" style="min-height:30px;">',
            '            <el-col :span="1"></el-col>',
            '            <el-col :span="23"><el-tag size="mini" type="info">{{ t(\'ui.aiparser.unmapped\', \'無對應詞條\') }}</el-tag> {{ item.text }}</el-col>',
            '          </el-row>',
            '          <el-row v-else-if="!item.refineInterval || effectiveValue(item, group) !== 0" :key="item.id + (item.skillName || item.targetName || \'\') + \'_\' + eidx" :gutter="6" type="flex" align="middle" style="min-height:34px;">',
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
            '      </div>',
            '    </el-col>',
            '    <el-col :span="7" class="ai-parser-column">',
            '      <div class="ai-parser-column-header">',
            '        <b>{{ t(\'ui.aiparser.result.title\', \'整合後效果\') }}</b>',
            '      </div>',
            '      <div class="ai-parser-column-scroll themed-scrollbar">',
            '        <div v-if="mergedPreview.length === 0 && mergedTargetedPreview.length === 0" style="color:#909399;">{{ t(\'ui.aiparser.result.empty\', \'勾選中間的區塊後，這裡會顯示加總後實際要寫入裝備的效果。\') }}</div>',
            '        <div v-if="mergedPreview.length > 0" class="bg-purple-light" style="margin-bottom:8px; padding:8px 10px; border-radius:4px;">',
            '          <div style="margin-bottom:4px;"><b>{{ t(\'ui.aiparser.mergedpreview.title\', \'套用後加總預覽（勾選區塊相同效果會加總成一筆寫入裝備）：\') }}</b></div>',
            '          <el-row v-for="item in mergedPreview" :key="item.id" :gutter="6" type="flex" align="middle" style="height:30px;">',
            '            <el-col :span="12"><span class="EffectType" :class="effectTagClass(item.id)">{{ t(item.id, item.label) }}</span></el-col>',
            '            <el-col :span="2">{{ item.opersymbol }}</el-col>',
            '            <el-col :span="6">{{ item.value }}</el-col>',
            '            <el-col :span="4">{{ item.suffixsymbol }}</el-col>',
            '          </el-row>',
            '        </div>',
            '        <div v-if="mergedTargetedPreview.length > 0" class="bg-purple-light2" style="margin-bottom:8px; padding:8px 10px; border-radius:4px;">',
            '          <div style="margin-bottom:4px;"><b>{{ t(\'ui.aiparser.targetedpreview.title\', \'指定對象效果加總預覽（技能/種族/體型/階級/屬性，按上方「套用」時一起寫入裝備）：\') }}</b></div>',
            '          <el-row v-for="row in mergedTargetedPreview" :key="row.key" :gutter="6" type="flex" align="middle" style="height:30px;">',
            '            <el-col :span="14"><span class="EffectType" :class="effectTagClass(row.id)">{{ t(row.id, row.label) }}</span>：{{ row.targetName }}</el-col>',
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
