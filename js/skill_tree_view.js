/*
 * 技能樹配點 dialog（純規劃/模擬工具，不影響現有傷害/屬性計算，也不寫回
 * skills.json）。資料來自 SkillTreeData（js/skill_tree_data.js），元件本身
 * 只負責畫面、配點狀態、加點時自動補前置、減點時連鎖歸零。
 *
 * 用 v-if 包住這個元件（見 index.html），每次打開對話框都是全新實體：
 * 配點結果故意不做任何儲存，關閉/重新整理就重置，跟 v-if 的生命週期正好一致。
 */
(function () {
    'use strict';

    var HOLD_DELAY_MS = 400;
    var HOLD_INTERVAL_MS = 110;
    var CELL_SIZE = 68;
    var CELL_GAP = 6;
    // 跟計算機本身「儲存配置」用的 key 完全分開，配點只是本機暫存，不會被存進配置檔
    var SKILLTREE_STORAGE_KEY = 'ROCalculator_SkillTreeLevels';

    Vue.component('skill-tree-dialog', {
        props: {
            visible: { type: Boolean, default: false },
            t: { type: Function, default: function (id, fallback) { return fallback; } },
            // 父層的 dataPath(filename) -> 'data/' + filename，跟主畫面其他資料載入用同一份規則
            dataPath: { type: Function, default: function (filename) { return 'data/' + filename; } },
            // 跟主畫面判斷技能版本同一顆開關（isZeroMode），不在這裡另外做一顆下拉——
            // true 用 data/grf/zero/，false 用 data/grf/standard/（含三轉四轉）。
            isZeroMode: { type: Boolean, default: false },
            // 父層目前的 UI 語系（uiLocale），技能名稱要照這個語系從 skill_i18n.csv 挑對應欄位
            uiLocale: { type: String, default: 'zh-TW' },
            // 父層目前載入的傷害計算技能清單（DefaultDB_Skill，來自 skills.json / skills_zero.json，
            // 跟 isZeroMode 是同一顆開關切換的），用來在右側詳細資料找出「id 包含目前選取 skid」的
            // 傷害計算分支（例如 RK_HUNDREDSPEAR 跟 RK_HUNDREDSPEAR(ex) 都算），給使用者一鍵套用。
            skillList: { type: Array, default: function () { return []; } },
            // 父層目前選擇的職業（status.classid，例如 'RK'），開對話框時預設職業頁要跟外面
            // 保持一致，而不是每次都跳回清單第一個職業。
            currentClassId: { type: String, default: '' },
        },
        data: function () {
            return {
                loading: true,
                loadError: '',
                skillTreeByJob: {},
                skillInfo: {},
                skillDescript: {},
                skillDelay: {},
                skillNameMap: {},
                jobNameMap: {},
                skillIconMap: {},
                questSkillSet: {},
                selectedFinalClass: '',
                levels: {}, // { [jobKey]: { [skid]: level } }
                selectedJobKey: '',
                selectedSkid: '',
                highlightJobKey: '',
                highlightSkid: '',
            };
        },
        computed: {
            dialogVisible: {
                get: function () { return this.visible; },
                set: function (v) { this.$emit('update:visible', v); },
            },
            dataset: function () { return this.isZeroMode ? 'zero' : 'standard'; },
            datasetInfo: function () { return SkillTreeData.DATASETS[this.dataset]; },
            jobLineage: function () { return this.datasetInfo.lineage; },
            // 下拉選單的職業名稱不再另外寫死組好的「a/b/c/d」字串——直接把這條職業線
            // 每個階段（stages）的 JOBID 名稱（jobNameMap，依 uiLocale）串起來，
            // 之後 lineage 表加轉職階段時，選單文字會自動跟著多一段，不用回頭改字串。
            finalClassOptions: function () {
                var self = this;
                return this.jobLineage.map(function (entry) {
                    var label = entry.stages.map(function (stage) { return self.jobLabel(stage); }).join('/');
                    return { value: entry.finalClass, label: label };
                });
            },
            currentLineage: function () {
                var selected = this.selectedFinalClass;
                return this.jobLineage.find(function (e) { return e.finalClass === selected; }) || null;
            },
            pagesToShow: function () {
                return this.currentLineage ? this.currentLineage.stages : [];
            },
            selectedDetail: function () {
                if (!this.selectedSkid) return null;
                return this.buildDetail(this.selectedJobKey, this.selectedSkid);
            },
            // 目前選取技能的「直接前置」skid 集合，用來把前置方塊背景高亮
            selectedPrereqSet: function () {
                var set = {};
                if (this.selectedDetail) {
                    this.selectedDetail.needList.forEach(function (req) { set[req.skid] = true; });
                }
                return set;
            },
            // 有些資料來源（例如四轉/標準版）沒有提供 skilldelaylist，這種情況下
            // 詠唱延遲整欄都是空的，乾脆不顯示那兩欄，只留 SP。
            hasDelayData: function () {
                return Object.keys(this.skillDelay).length > 0;
            },
            // 目前選取技能在傷害計算清單（skills.json / skills_zero.json）裡「id 包含這個 skid」
            // 的所有分支：同一個 skid 可能對應多筆傷害計算資料（例如天龍光環等特殊狀態的變體），
            // 用 id 字串包含關係抓出全部，讓使用者從右側詳細資料直接一鍵套用到主畫面。
            matchedSkillEntries: function () {
                var skid = this.selectedSkid;
                if (!skid) return [];
                return this.skillList.filter(function (item) {
                    return item && item.skill && typeof item.skill.id === 'string' && item.skill.id.indexOf(skid) !== -1;
                });
            },
        },
        watch: {
            // isZeroMode 理論上不太會在對話框開著的時候變動，但保險起見還是處理一下：
            // 換資料來源要重新載入，職業清單也完全不同，但盡量保留使用者原本選的職業
            // （selectedFinalClass 剛好是共用的代碼，例如 RK 兩邊都有）。
            isZeroMode: function () {
                this.selectedJobKey = '';
                this.selectedSkid = '';
                this.load();
            },
        },
        mounted: function () {
            this.load();
            window.addEventListener('mouseup', this.stopHold);
        },
        beforeDestroy: function () {
            this.stopHold();
            window.removeEventListener('mouseup', this.stopHold);
        },
        methods: {
            load: function () {
                var self = this;
                this.loading = true;
                this.loadError = '';
                var basePath = this.dataset === 'zero' ? this.dataPath('grf/zero/') : this.dataPath('grf/standard/');
                Promise.all([
                    SkillTreeData.loadSkillTreeData(basePath),
                    SkillTreeData.loadSkillI18n(this.dataPath('skill_i18n.csv')),
                    SkillTreeData.loadSkillIconMap(this.dataPath('skill_icon.csv')),
                    SkillTreeData.loadQuestSkillSet(this.dataPath('skilltree_quest_skills.txt')),
                    SkillTreeData.loadSkillI18n(this.dataPath('skilltree_job_i18n.csv')),
                ]).then(function (results) {
                    var treeData = results[0];
                    self.skillTreeByJob = treeData.skillTreeByJob;
                    self.skillInfo = treeData.skillInfo;
                    self.skillDescript = treeData.skillDescript;
                    self.skillDelay = treeData.skillDelay;
                    self.skillNameMap = results[1];
                    self.skillIconMap = results[2];
                    self.questSkillSet = results[3];
                    self.jobNameMap = results[4];
                    self.loading = false;
                    // 保留使用者原本選的職業，除非目前這個資料來源根本沒有這個職業才重新挑一個——
                    // 重新挑的時候優先跟外面主畫面目前選擇的職業一致（currentClassId），沒有才退回清單第一個。
                    if (!self.selectedFinalClass || !self.finalClassOptions.some(function (o) { return o.value === self.selectedFinalClass; })) {
                        var preferDefault = self.currentClassId && self.finalClassOptions.some(function (o) { return o.value === self.currentClassId; })
                            ? self.currentClassId
                            : (self.finalClassOptions.length ? self.finalClassOptions[0].value : '');
                        self.selectedFinalClass = preferDefault;
                    }
                    self.levels = self.loadSavedLevels();
                }).catch(function (e) {
                    console.error('[SkillTreeDialog] load failed', e);
                    self.loadError = String(e && e.message ? e.message : e);
                    self.loading = false;
                });
            },
            onChangeClass: function () {
                // 換職業不清空各頁配點——不同 finalClass 可能共用同一頁（例如
                // JT_SWORDMAN 同時是 RK 跟 RG 的前段），保留使用者已經配好的點數。
            },
            // 配點暫存到 localStorage（依資料來源分開存），跟計算機本身的「儲存配置」
            // 是完全不同的兩套東西——不會被存進配置檔，只是單純「下次打開這個對話框
            // 還記得上次配到哪」的本機暫存。
            loadSavedLevels: function () {
                try {
                    var raw = localStorage.getItem(SKILLTREE_STORAGE_KEY);
                    var all = raw ? JSON.parse(raw) : {};
                    return (all && all[this.dataset]) || {};
                } catch (e) {
                    return {};
                }
            },
            saveLevels: function () {
                try {
                    var raw = localStorage.getItem(SKILLTREE_STORAGE_KEY);
                    var all = {};
                    try { all = raw ? JSON.parse(raw) : {}; } catch (e2) { all = {}; }
                    all[this.dataset] = this.levels;
                    localStorage.setItem(SKILLTREE_STORAGE_KEY, JSON.stringify(all));
                } catch (e) {
                    // localStorage 被瀏覽器封鎖（無痕模式等）就安靜放棄，不影響正常使用
                }
            },

            gridEntries: function (jobKey) {
                return this.skillTreeByJob[jobKey] || [];
            },
            gridRowCount: function (jobKey) {
                var entries = this.gridEntries(jobKey);
                return entries.reduce(function (m, e) { return Math.max(m, e.row); }, 0) + 1;
            },
            squareStyle: function (entry) {
                return {
                    gridColumn: (entry.colInRow + 1) + ' / span 1',
                    gridRow: (entry.row + 1) + ' / span 1',
                };
            },
            // 依目前 UI 語系取職業頁名稱（skilltree_job_i18n.csv），找不到該語系就退回
            // en -> zh-TW，跟 skillName() 同一套規則；CSV 完全沒有這個 JOBID 時退回代碼本身。
            jobLabel: function (jobKey) {
                var entry = this.jobNameMap[jobKey];
                if (entry) {
                    var name = entry[this.uiLocale] || entry['en'] || entry['zh-TW'];
                    if (name) return name;
                }
                return jobKey;
            },
            // 左欄上方「職業快速跳轉」按鈕：捲到該職業頁在下方捲動區塊裡的位置。按鈕數量
            // 直接跟著 pagesToShow 走（Zero 版通常 1~2 個，四轉版常見 3~4 個），不寫死。
            scrollToPage: function (jobKey) {
                var el = this.$refs['page-' + jobKey];
                if (Array.isArray(el)) el = el[0];
                if (el && el.scrollIntoView) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            },

            // 依目前 UI 語系取技能名稱；找不到該語系就退回 en -> zh-TW（跟主程式 t() 同一套規則）。
            // skill_i18n.csv 完全沒有這個技能時（目前約六成技能是這樣），退回 skilldescript.lua
            // 自己解析出來的名稱——lua 第一行原始格式是「中文名(English Name)」，之前這裡只用了
            // 中文那半、把已經解析好的 nameEn 晾在旁邊沒用到，英文介面下自然一路顯示中文。
            // 這裡補上跟上面同一套 uiLocale -> en -> zh-TW 的退階規則，最後才是純代碼。
            skillName: function (skid) {
                var entry = this.skillNameMap[skid];
                if (entry) {
                    var name = entry[this.uiLocale] || entry['en'] || entry['zh-TW'];
                    if (name) return name;
                }
                // 括號變體（例如傷害計算清單裡的 RK_HUNDREDSPEAR(ex)）若沒有專屬翻譯，
                // 退回不含括號的基礎 id 找翻譯，規則跟主程式 getSkillName() 一致。
                var baseSkid = skid.split('(')[0];
                if (baseSkid !== skid) {
                    var baseEntry = this.skillNameMap[baseSkid];
                    if (baseEntry) {
                        var baseName = baseEntry[this.uiLocale] || baseEntry['en'] || baseEntry['zh-TW'];
                        if (baseName) return baseName;
                    }
                }
                var d = this.skillDescript[baseSkid];
                if (d) {
                    var descFallback = { 'zh-TW': d.nameZh, en: d.nameEn };
                    var descName = descFallback[this.uiLocale] || descFallback.en || descFallback['zh-TW'];
                    if (descName) return descName;
                }
                return skid;
            },
            skillIcon: function (skid) {
                return this.skillIconMap[skid] || '';
            },
            maxLvOf: function (skid) {
                var info = this.skillInfo[skid];
                return info ? info.maxLv : 1;
            },
            squareLevelText: function (jobKey, skid) {
                if (this.isQuestSkill(skid)) return this.t('ui.skilltree.quest', '任務');
                return this.levelOf(jobKey, skid) + '/' + this.maxLvOf(skid);
            },
            levelOf: function (jobKey, skid) {
                return (this.levels[jobKey] && this.levels[jobKey][skid]) || 0;
            },
            setLevel: function (jobKey, skid, lv) {
                if (!this.levels[jobKey]) this.$set(this.levels, jobKey, {});
                this.$set(this.levels[jobKey], skid, lv);
            },
            needListOf: function (jobKey, skid) {
                return SkillTreeData.getEffectiveNeedList(this.skillInfo, jobKey, skid);
            },
            isQuestSkill: function (skid) {
                return !!this.questSkillSet[skid];
            },
            // 前置技能實際歸屬哪一頁：像 KN_BOWLINGBASH（二轉）的前置裡有 SM_BASH（一轉），
            // 這種跨頁前置的等級要記在 SM_BASH 真正所在的那一頁（一轉），不能因為是在二轉頁
            // 觸發配點，就把 SM_BASH 的等級／點數誤算進二轉頁——那樣會產生「二轉頁裡沒有
            // 任何方塊對應、但確實佔用點數」的幽靈點數，讓兩頁的已用點數跟著算錯。
            // 找不到（理論上不會發生）就退回原本呼叫的 jobKey。
            homeJobKeyFor: function (skid, fallbackJobKey) {
                var pages = this.pagesToShow;
                for (var i = 0; i < pages.length; i++) {
                    var jobKey = pages[i];
                    var entries = this.gridEntries(jobKey);
                    for (var j = 0; j < entries.length; j++) {
                        if (entries[j].skid === skid) return jobKey;
                    }
                }
                return fallbackJobKey;
            },
            // 前置需求是否已滿足：任務技能一律視為已滿足（不能配點、也不擋別人）
            isReqSatisfied: function (jobKey, req) {
                if (this.isQuestSkill(req.skid)) return true;
                var homeKey = this.homeJobKeyFor(req.skid, jobKey);
                return this.levelOf(homeKey, req.skid) >= req.level;
            },
            usedPoints: function (jobKey) {
                var self = this;
                var lv = this.levels[jobKey] || {};
                return Object.keys(lv).reduce(function (s, k) {
                    return s + (self.isQuestSkill(k) ? 0 : (lv[k] || 0));
                }, 0);
            },
            pointCap: function (jobKey) {
                return this.datasetInfo.pointCap[jobKey] || 0;
            },
            // 前面轉職點數用超過上限時，依序用後面轉職的餘額墊（可以連續跨好幾轉，例如
            // 一轉超出的部分先看二轉有沒有餘額，二轉不夠再看三轉、四轉），對應遊戲裡
            // 「後面轉職多出來的技能點也能回頭加前面轉職技能」的規則。逐頁往右掃一次，
            // carry 是「還沒被墊完、要留給下一頁繼續墊」的欠款；掃完所有頁還剩下的 carry，
            // 才是真的沒有任何點數池能補的缺口。
            stagePointInfo: function () {
                var self = this;
                var pages = this.pagesToShow;
                var perPage = [];
                var carry = 0;
                pages.forEach(function (jobKey) {
                    var raw = self.usedPoints(jobKey);
                    var cap = self.pointCap(jobKey);
                    var spare = Math.max(0, cap - raw);
                    var funded = Math.min(carry, spare);
                    var ownOverflow = Math.max(0, raw - cap);
                    carry = (carry - funded) + ownOverflow;
                    perPage.push({ jobKey: jobKey, raw: raw, cap: cap, borrowedInto: funded, ownOverflow: ownOverflow, display: raw + funded });
                });
                return { perPage: perPage, unfunded: carry };
            },
            stagePageInfo: function (jobKey) {
                return this.stagePointInfo().perPage.find(function (p) { return p.jobKey === jobKey; }) || null;
            },
            displayUsedPoints: function (jobKey) {
                var info = this.stagePageInfo(jobKey);
                return info ? info.display : this.usedPoints(jobKey);
            },
            // 這一頁本身有超額，而且整條職業線掃完之後還是有補不齊的缺口，才算真的超額
            isOverCap: function (jobKey) {
                var info = this.stagePageInfo(jobKey);
                if (!info) return false;
                return info.ownOverflow > 0 && this.stagePointInfo().unfunded > 0;
            },
            borrowNote: function (jobKey) {
                var info = this.stagePageInfo(jobKey);
                if (!info) return '';
                var parts = [];
                if (info.ownOverflow > 0) {
                    parts.push(this.t('ui.skilltree.overflow', '（本頁超出上限 {n} 點，由後續轉職點數池支應）').replace('{n}', info.ownOverflow));
                }
                if (info.borrowedInto > 0) {
                    parts.push(this.t('ui.skilltree.lent', '（其中 {n} 點借給前面轉職使用）').replace('{n}', info.borrowedInto));
                }
                return parts.join('');
            },
            // 整條職業線掃完之後，還有多少點數是所有轉職點數池加起來都補不了的（顯示成上方全域警示）
            globalUnfundedAmount: function () {
                return this.stagePointInfo().unfunded;
            },
            resetAll: function () {
                this.levels = {};
                this.saveLevels();
            },

            // 加點：先遞迴把前置補到需求等級，再把目標技能加 1 級。回傳 false 代表
            // 已經到 MaxLv、沒有動作了（給連續按住的迴圈用來判斷該不該停）。
            incLevel: function (jobKey, skid) {
                if (this.isQuestSkill(skid)) return false;
                var info = this.skillInfo[skid];
                if (!info) return false;
                var cur = this.levelOf(jobKey, skid);
                if (cur >= info.maxLv) return false;
                this.fulfillPrereq(jobKey, skid);
                this.setLevel(jobKey, skid, cur + 1);
                return true;
            },
            // 任務技能一律視為已擁有，不遞迴、不佔用點數，直接跳過。前置技能一律記在它
            // 「自己實際所在」的那一頁（見 homeJobKeyFor），不是觸發配點當下的那一頁。
            fulfillPrereq: function (jobKey, skid) {
                var self = this;
                this.needListOf(jobKey, skid).forEach(function (req) {
                    if (self.isQuestSkill(req.skid)) return;
                    var homeKey = self.homeJobKeyFor(req.skid, jobKey);
                    if (self.levelOf(homeKey, req.skid) < req.level) {
                        self.fulfillPrereq(homeKey, req.skid);
                        self.setLevel(homeKey, req.skid, req.level);
                    }
                });
            },

            // 減點：目標技能降 1 級，然後整個職業線（目前顯示的所有頁）一起掃描連鎖——
            // 前置有可能跨頁（一轉技能被二轉技能當前置），所以不能只掃降點那一頁，
            // 否則另一頁裡依賴它的技能不會被連鎖歸零。只要前置需求不再被滿足就直接
            // 歸零（不是降到剛好符合），重複掃描到沒有變動為止。
            decLevel: function (jobKey, skid) {
                if (this.isQuestSkill(skid)) return false;
                var cur = this.levelOf(jobKey, skid);
                if (cur <= 0) return false;
                this.setLevel(jobKey, skid, cur - 1);
                this.cascadeZero();
                return true;
            },
            cascadeZero: function () {
                var self = this;
                var pages = this.pagesToShow;
                var changed = true;
                var guard = 0;
                while (changed && guard < 200) {
                    changed = false;
                    guard++;
                    pages.forEach(function (jobKey) {
                        self.gridEntries(jobKey).forEach(function (entry) {
                            var skid = entry.skid;
                            var cur = self.levelOf(jobKey, skid);
                            if (cur <= 0) return;
                            var ok = self.needListOf(jobKey, skid).every(function (req) {
                                return self.isReqSatisfied(jobKey, req);
                            });
                            if (!ok) {
                                self.setLevel(jobKey, skid, 0);
                                changed = true;
                            }
                        });
                    });
                }
            },

            stepOnce: function (jobKey, skid, dir) {
                var changed = dir > 0 ? this.incLevel(jobKey, skid) : this.decLevel(jobKey, skid);
                if (changed) this.saveLevels();
                return changed;
            },
            onWheel: function (jobKey, skid, evt) {
                this.stepOnce(jobKey, skid, evt.deltaY < 0 ? 1 : -1);
                this.selectSkill(jobKey, skid);
            },
            // 右鍵維持按住連續減點；左鍵已經改成點擊=釘選詳細資料、雙擊=衝滿等，不需要連續加點了
            startHold: function (jobKey, skid, dir) {
                this.stopHold();
                this.stepOnce(jobKey, skid, dir);
                var self = this;
                this._holdTimeout = setTimeout(function () {
                    self._holdInterval = setInterval(function () {
                        if (!self.stepOnce(jobKey, skid, dir)) self.stopHold();
                    }, HOLD_INTERVAL_MS);
                }, HOLD_DELAY_MS);
            },
            stopHold: function () {
                if (this._holdTimeout) { clearTimeout(this._holdTimeout); this._holdTimeout = null; }
                if (this._holdInterval) { clearInterval(this._holdInterval); this._holdInterval = null; }
            },

            // 左鍵單擊：只釘選/顯示右側詳細資料，不改變等級
            selectSkill: function (jobKey, skid) {
                this.selectedJobKey = jobKey;
                this.selectedSkid = skid;
            },
            // 左鍵連點（雙擊）：遞迴補前置後直接衝到 MaxLv
            onMaxOut: function (jobKey, skid) {
                if (this.isQuestSkill(skid)) return;
                var didAnything = false;
                while (this.incLevel(jobKey, skid)) { didAnything = true; /* 衝到滿等為止 */ }
                if (didAnything) this.saveLevels();
                this.selectSkill(jobKey, skid);
            },
            // 右側詳細資料的「套用」按鈕：把主畫面目前的技能選擇切換成這個傷害計算分支，
            // 然後關閉技能樹 dialog——配點本身不影響傷害計算，這裡只是幫使用者少切一次「技能設定」。
            // 同時帶上目前技能樹頁面對應的職業（selectedFinalClass），因為使用者可能還沒在
            // 主畫面選職業就直接開技能樹操作，這種情況下套用技能時要連職業一起帶過去。
            applyToMainSkill: function (skillId) {
                this.$emit('select-main-skill', { skillId: skillId, finalClass: this.selectedFinalClass });
                this.dialogVisible = false;
            },
            jumpToPrereq: function (skid) {
                var jobKey = this.selectedJobKey;
                this.highlightJobKey = jobKey;
                this.highlightSkid = skid;
                this.selectSkill(jobKey, skid);
                var self = this;
                setTimeout(function () {
                    if (self.highlightSkid === skid) { self.highlightJobKey = ''; self.highlightSkid = ''; }
                }, 1500);
            },
            isHighlighted: function (jobKey, skid) {
                return this.highlightJobKey === jobKey && this.highlightSkid === skid;
            },
            // ms -> 秒數顯示，去掉多餘的小數 0（100 -> "0.1s"，30000 -> "30s"）
            formatDelaySeconds: function (ms) {
                if (ms === undefined) return '-';
                return (Math.round(ms) / 1000) + 's';
            },

            buildDetail: function (jobKey, skid) {
                var info = this.skillInfo[skid] || { maxLv: 1, spAmount: [] };
                var desc = this.skillDescript[skid] || { nameZh: skid, nameEn: '', lines: [] };
                var delay = this.skillDelay[skid] || {};
                var need = this.needListOf(jobKey, skid);
                var cur = this.levelOf(jobKey, skid);
                var self = this;
                var levelsInfo = [];
                for (var lv = 1; lv <= info.maxLv; lv++) {
                    levelsInfo.push({
                        lv: lv,
                        sp: info.spAmount[lv - 1],
                        fixedDelay: delay.fixedDelay ? delay.fixedDelay[lv - 1] : undefined,
                        statDelay: delay.statDelay ? delay.statDelay[lv - 1] : undefined,
                    });
                }
                return {
                    skid: skid,
                    jobKey: jobKey,
                    nameZh: this.skillName(skid),
                    nameEn: desc.nameEn,
                    lines: desc.lines,
                    maxLv: info.maxLv,
                    curLv: cur,
                    levelsInfo: levelsInfo,
                    needList: need.map(function (req) {
                        // curLv 要看這個前置技能「自己實際所在」的那一頁，不是 jobKey 這一頁——
                        // 不然像一轉技能被二轉技能當前置時，這裡會一直讀到 0（BUG：明明滿足了
                        // 卻不顯示目前等級）。
                        var homeKey = self.homeJobKeyFor(req.skid, jobKey);
                        return {
                            skid: req.skid,
                            level: req.level,
                            name: self.skillName(req.skid),
                            curLv: self.levelOf(homeKey, req.skid),
                            isQuest: self.isQuestSkill(req.skid),
                            satisfied: self.isReqSatisfied(jobKey, req),
                        };
                    }),
                };
            },
        },
        template: [
            '<el-dialog :visible.sync="dialogVisible" custom-class="Dialogue-container SkillTreeDialog" width="66%" top="30px" center :close-on-click-modal="false">',
            '  <span slot="title">{{ t(\'ui.skilltree.title\', \'技能樹配點\') }}</span>',
            '  <div v-if="loading" class="textcenter" style="padding:40px 0;">{{ t(\'ui.common.loading\', \'載入中...\') }}</div>',
            '  <div v-else-if="loadError" class="textcenter" style="padding:40px 0; color:#f56c6c;">{{ loadError }}</div>',
            '  <div v-else class="skill-tree-body">',
            '    <div class="skill-tree-global-warn" :class="{ invisible: globalUnfundedAmount() <= 0 }">',
            '      {{ t(\'ui.skilltree.insufficient\', \'⚠ 目前配點總和超出所有轉職點數池加總 {n} 點\').replace(\'{n}\', globalUnfundedAmount()) }}',
            '    </div>',
            '    <div class="skill-tree-columns-row">',
            '      <div class="skill-tree-pages-col">',
            '        <div class="skill-tree-pages-header">',
            '          <el-row :gutter="10" type="flex" align="middle" style="margin-bottom:8px;">',
            '            <el-col :span="6">{{ t(\'ui.skilltree.selectclass\', \'選擇職業\') }}</el-col>',
            '            <el-col :span="12">',
            '              <el-select v-model="selectedFinalClass" size="small" style="width:100%;" v-on:change="onChangeClass">',
            '                <el-option v-for="opt in finalClassOptions" :key="opt.value" :value="opt.value" :label="opt.label"></el-option>',
            '              </el-select>',
            '            </el-col>',
            '            <el-col :span="6">',
            '              <el-button size="small" v-on:click="resetAll">{{ t(\'ui.skilltree.reset\', \'重置\') }}</el-button>',
            '            </el-col>',
            '          </el-row>',
            '          <div class="skill-tree-info-banner">',
            '            {{ t(\'ui.skilltree.usagehint\', \'使用滑鼠滾輪調整等級、雙擊設定為最大等級；這邊僅模擬配點，不包含計算機本身的被動／BUFF效果\') }}',
            '          </div>',
            '          <div class="skill-tree-jump-row">',
            '            <el-button v-for="jobKey in pagesToShow" :key="jobKey" size="small" plain v-on:click="scrollToPage(jobKey)">',
            '              {{ jobLabel(jobKey) }}',
            '            </el-button>',
            '          </div>',
            '        </div>',
            '        <div class="skill-tree-pages-scroll themed-scrollbar">',
            '          <div v-for="jobKey in pagesToShow" :key="jobKey" :ref="\'page-\' + jobKey" class="skill-tree-page">',
            '            <div class="skill-tree-page-header">',
            '              <b>{{ jobLabel(jobKey) }}</b>',
            '              <div class="skill-tree-points" :class="{ over: isOverCap(jobKey) }">',
            '                {{ t(\'ui.skilltree.pointsused\', \'已用點數\') }}: {{ displayUsedPoints(jobKey) }} / {{ pointCap(jobKey) }}',
            '              </div>',
            '              <div v-if="borrowNote(jobKey)" class="skill-tree-points-note">{{ borrowNote(jobKey) }}</div>',
            '            </div>',
            '            <div class="skill-tree-grid" :style="{ gridTemplateRows: \'repeat(\' + gridRowCount(jobKey) + \', ' + CELL_SIZE + 'px)\' }">',
            '              <div v-for="entry in gridEntries(jobKey)" :key="entry.skid"',
            '                   class="skill-square"',
            '                   :class="{ maxed: levelOf(jobKey, entry.skid) >= maxLvOf(entry.skid), zero: levelOf(jobKey, entry.skid) === 0,',
            '                             highlight: isHighlighted(jobKey, entry.skid), quest: isQuestSkill(entry.skid),',
            '                             selected: selectedJobKey === jobKey && selectedSkid === entry.skid,',
            '                             \'prereq-hover\': selectedJobKey === jobKey && selectedPrereqSet[entry.skid] }"',
            '                   :style="squareStyle(entry)"',
            '                   v-on:wheel.prevent="onWheel(jobKey, entry.skid, $event)"',
            '                   v-on:click="selectSkill(jobKey, entry.skid)"',
            '                   v-on:dblclick="onMaxOut(jobKey, entry.skid)"',
            '                   v-on:mousedown.right.prevent="startHold(jobKey, entry.skid, -1)"',
            '                   v-on:contextmenu.prevent',
            '                   v-on:mouseup="stopHold">',
            '                <img v-if="skillIcon(entry.skid)" :src="skillIcon(entry.skid)" class="skill-square-icon" />',
            '                <div v-else class="skill-square-name">{{ skillName(entry.skid) }}</div>',
            '                <div class="skill-square-level">{{ squareLevelText(jobKey, entry.skid) }}</div>',
            '              </div>',
            '            </div>',
            '          </div>',
            '        </div>',
            '      </div>',
            '      <div class="skill-tree-detail-col themed-scrollbar">',
            '        <div v-if="!selectedDetail" class="skill-tree-detail-empty">{{ t(\'ui.skilltree.hoverhint\', \'點一下技能方塊可釘選右側說明\') }}</div>',
            '        <div v-else class="skill-tree-detail">',
            '          <div v-if="matchedSkillEntries.length" class="skill-tree-detail-apply-row">',
            '            <el-button v-for="entry in matchedSkillEntries" :key="entry.skill.id" size="mini" type="success" plain',
            '                 v-on:click="applyToMainSkill(entry.skill.id)">',
            '              {{ t(\'ui.skilltree.applyskill\', \'套用\') }}：{{ skillName(entry.skill.id) }}',
            '            </el-button>',
            '          </div>',
            '          <div class="skill-tree-detail-title">{{ selectedDetail.nameZh }} <span v-if="selectedDetail.nameEn" class="skill-tree-detail-nameen">({{ selectedDetail.nameEn }})</span></div>',
            '          <div class="skill-tree-detail-id">{{ selectedDetail.skid }}</div>',
            '          <div class="skill-tree-detail-sub">Lv {{ selectedDetail.curLv }} / {{ selectedDetail.maxLv }}</div>',
            '          <div class="skill-tree-detail-desc">',
            '            <div v-for="(line, i) in selectedDetail.lines" :key="i">{{ line }}</div>',
            '          </div>',
            '          <div v-if="selectedDetail.needList.length" class="skill-tree-detail-need">',
            '            <div class="skill-tree-detail-label">{{ t(\'ui.skilltree.prereq\', \'前置需求\') }}</div>',
            '            <div v-for="req in selectedDetail.needList" :key="req.skid"',
            '                 class="skill-tree-need-item" :class="{ ok: req.satisfied }"',
            '                 v-on:click="jumpToPrereq(req.skid)">',
            '              {{ req.name }} Lv{{ req.level }} <span v-if="req.isQuest">({{ t(\'ui.skilltree.questsatisfied\', \'任務取得，視為已滿足\') }})</span><span v-else>({{ req.curLv }}/{{ req.level }})</span>',
            '            </div>',
            '          </div>',
            '          <div class="skill-tree-detail-label" style="margin-top:8px;">{{ t(\'ui.skilltree.perlevel\', \'各等級 SP\') }}{{ hasDelayData ? \' / \' + t(\'ui.skilltree.castdelay\', \'詠唱延遲\') : \'\' }}</div>',
            '          <table class="skill-tree-lv-table">',
            '            <tr><th>Lv</th><th>SP</th><th v-if="hasDelayData">{{ t(\'ui.skilltree.fixedcast\', \'固定詠唱\') }}</th><th v-if="hasDelayData">{{ t(\'ui.skilltree.variablecast\', \'變動詠唱\') }}</th></tr>',
            '            <tr v-for="li in selectedDetail.levelsInfo" :key="li.lv" :class="{ active: li.lv === selectedDetail.curLv }">',
            '              <td>{{ li.lv }}</td>',
            '              <td>{{ li.sp !== undefined ? li.sp : \'-\' }}</td>',
            '              <td v-if="hasDelayData">{{ formatDelaySeconds(li.fixedDelay) }}</td>',
            '              <td v-if="hasDelayData">{{ formatDelaySeconds(li.statDelay) }}</td>',
            '            </tr>',
            '          </table>',
            '        </div>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</el-dialog>',
        ].join('\n'),
    });
})();
