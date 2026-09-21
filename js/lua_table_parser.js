/*
 * 小型 Lua table 字面量解析器，只處理 GRF Editor Decompiler 產出的
 * data/grf/zero/*.lua 這幾個檔案共通的固定樣式：
 *   NAME = {
 *     [SKID.X] = { "X", SkillName = "...", MaxLv = 10, SpAmount = {1,2,3}, ... },
 *     ...
 *   }
 *   JobSkillTab.ChangeSkillTabName(...)   -- 頂層其他語句，直接忽略
 *
 * 不是完整的 Lua 直譯器：只認得 table constructor、字串/數字/布林/
 * `Module.Field` 成員存取（如 SKID.SM_BASH / JOBID.JT_SWORDMAN，會被
 * 正規化成去掉前綴的純字串 "SM_BASH" / "JT_SWORDMAN"）。遇到解析
 * 不出來的頂層表格會記警告並跳過，不會讓其他表格解析失敗。
 */
(function (global) {
    'use strict';

    var ESCAPES = { 'n': '\n', 't': '\t', 'r': '\r', '"': '"', '\\': '\\', "'": "'" };

    function tokenize(src) {
        var tokens = [];
        var i = 0;
        var n = src.length;
        while (i < n) {
            var c = src[i];
            if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
            if (c === '-' && src[i + 1] === '-') {
                if (src[i + 2] === '[' && src[i + 3] === '[') {
                    var endIdx = src.indexOf(']]', i + 4);
                    i = (endIdx === -1) ? n : endIdx + 2;
                } else {
                    var nl = src.indexOf('\n', i + 2);
                    i = (nl === -1) ? n : nl + 1;
                }
                continue;
            }
            if (c === '"') {
                var buf = '';
                i++;
                while (i < n && src[i] !== '"') {
                    if (src[i] === '\\') {
                        var esc = src[i + 1];
                        buf += (ESCAPES.hasOwnProperty(esc) ? ESCAPES[esc] : esc);
                        i += 2;
                    } else {
                        buf += src[i];
                        i++;
                    }
                }
                i++; // closing quote
                tokens.push({ type: 'STRING', value: buf });
                continue;
            }
            if (c >= '0' && c <= '9') {
                var start = i;
                while (i < n && ((src[i] >= '0' && src[i] <= '9') || src[i] === '.')) i++;
                tokens.push({ type: 'NUMBER', value: parseFloat(src.slice(start, i)) });
                continue;
            }
            if (/[A-Za-z_]/.test(c)) {
                var start2 = i;
                while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
                tokens.push({ type: 'IDENT', value: src.slice(start2, i) });
                continue;
            }
            if ('{}[](),;=.'.indexOf(c) !== -1) {
                tokens.push({ type: 'PUNCT', value: c });
                i++;
                continue;
            }
            // 無法辨識的字元（理論上不會出現），直接跳過避免整體解析中斷
            i++;
        }
        tokens.push({ type: 'EOF', value: null });
        return tokens;
    }

    function Ctx(tokens) {
        this.tokens = tokens;
        this.pos = 0;
    }
    Ctx.prototype.peek = function (offset) {
        return this.tokens[this.pos + (offset || 0)];
    };
    Ctx.prototype.next = function () {
        return this.tokens[this.pos++];
    };
    Ctx.prototype.expectPunct = function (p) {
        var t = this.next();
        if (t.type !== 'PUNCT' || t.value !== p) {
            throw new Error('expected "' + p + '" but got ' + t.type + ' ' + JSON.stringify(t.value) + ' at token #' + (this.pos - 1));
        }
    };

    // 讀取 IDENT 或 IDENT.IDENT（SKID.X / JOBID.X），回傳正規化後的字串
    // （去掉最前面那段模組名，只留最後一段）。
    function readMemberOrIdent(ctx) {
        var t = ctx.next(); // IDENT
        var name = t.value;
        while (ctx.peek().type === 'PUNCT' && ctx.peek().value === '.') {
            ctx.next(); // '.'
            var field = ctx.next(); // IDENT
            name = field.value;
        }
        return name;
    }

    function parseValue(ctx) {
        var t = ctx.peek();
        if (t.type === 'STRING') { ctx.next(); return t.value; }
        if (t.type === 'NUMBER') { ctx.next(); return t.value; }
        if (t.type === 'PUNCT' && t.value === '-' ) {
            ctx.next();
            var num = ctx.next();
            if (num.type !== 'NUMBER') throw new Error('expected number after unary -');
            return -num.value;
        }
        if (t.type === 'PUNCT' && t.value === '{') { return parseTable(ctx); }
        if (t.type === 'IDENT') {
            if (t.value === 'true') { ctx.next(); return true; }
            if (t.value === 'false') { ctx.next(); return false; }
            if (t.value === 'nil') { ctx.next(); return null; }
            return readMemberOrIdent(ctx);
        }
        throw new Error('unexpected token ' + t.type + ' ' + JSON.stringify(t.value));
    }

    // 解析單一 table 欄位，寫入 result（hybrid array：具名 key 直接當
    // property，沒有 key 的按順序 push）。
    function parseField(ctx, result, autoIndexRef) {
        var t = ctx.peek();
        if (t.type === 'PUNCT' && t.value === '[') {
            ctx.next(); // '['
            var keyTok = ctx.peek();
            var key;
            if (keyTok.type === 'NUMBER') { ctx.next(); key = keyTok.value; }
            else if (keyTok.type === 'IDENT') { key = readMemberOrIdent(ctx); }
            else { throw new Error('unsupported computed key token ' + keyTok.type); }
            ctx.expectPunct(']');
            ctx.expectPunct('=');
            result[key] = parseValue(ctx);
            return;
        }
        if (t.type === 'IDENT') {
            var savedPos = ctx.pos;
            var name = ctx.next().value;
            if (ctx.peek().type === 'PUNCT' && ctx.peek().value === '=') {
                ctx.next(); // '='
                result[name] = parseValue(ctx);
                return;
            }
            // 不是具名欄位，倒回去交給 parseValue 當一般值處理
            // （例如 SKID.SM_BASH 這種 member ident 用在陣列項目裡）
            ctx.pos = savedPos;
            result[autoIndexRef.i++] = parseValue(ctx);
            return;
        }
        result[autoIndexRef.i++] = parseValue(ctx);
    }

    function parseTable(ctx) {
        ctx.expectPunct('{');
        var result = [];
        var autoIndexRef = { i: 0 };
        while (!(ctx.peek().type === 'PUNCT' && ctx.peek().value === '}')) {
            if (ctx.peek().type === 'EOF') throw new Error('unexpected EOF inside table');
            parseField(ctx, result, autoIndexRef);
            var sep = ctx.peek();
            if (sep.type === 'PUNCT' && (sep.value === ',' || sep.value === ';')) {
                ctx.next();
            } else {
                break;
            }
        }
        ctx.expectPunct('}');
        return result;
    }

    // 從目前 pos（應該正指著 '{'）安全跳過一整個 table，用來在單一
    // 頂層表格解析失敗時，讓外層掃描能繼續往後找下一個頂層表格。
    function skipBalancedTable(ctx) {
        if (!(ctx.peek().type === 'PUNCT' && ctx.peek().value === '{')) return;
        var depth = 0;
        do {
            var t = ctx.next();
            if (t.type === 'EOF') return;
            if (t.type === 'PUNCT' && t.value === '{') depth++;
            else if (t.type === 'PUNCT' && t.value === '}') depth--;
        } while (depth > 0);
    }

    function parse(src, opts) {
        var warn = (opts && opts.onWarning) || function () {};
        var tokens = tokenize(src);
        var ctx = new Ctx(tokens);
        var out = {};
        while (ctx.peek().type !== 'EOF') {
            var t = ctx.peek();
            var p1 = ctx.peek(1);
            var p2 = ctx.peek(2);
            if (t.type === 'IDENT' && p1.type === 'PUNCT' && p1.value === '=' && p2.type === 'PUNCT' && p2.value === '{') {
                var name = t.value;
                var startPos = ctx.pos;
                ctx.next(); // name
                ctx.next(); // '='
                try {
                    out[name] = parseTable(ctx);
                } catch (e) {
                    warn('parse "' + name + '" failed: ' + e.message);
                    ctx.pos = startPos + 2; // 回到 '{' 那個 token
                    skipBalancedTable(ctx);
                }
                continue;
            }
            ctx.next();
        }
        return out;
    }

    global.LuaTableParser = { parse: parse };
})(typeof window !== 'undefined' ? window : this);
