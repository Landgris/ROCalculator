/*
 * 安全算式直譯器，取代原本「關鍵字字串取代 + eval()」的做法。
 * 這份是 worker/src/formula-interpreter.js 的瀏覽器版本（同一套語法/邏輯，只是把
 * module.exports 換成掛在 window 上）。這隻檔案本身只是通用的算式解析器，不含任何
 * 技能/傷害公式的實際數值或商業邏輯，所以可以放心跟著 index.html 一起公開。
 *
 * 支援的語法（依優先權由低到高）：
 *   三元運算子 ?: （右結合，可巢狀）
 *   邏輯 || &&
 *   比較 > < >= <= == !=
 *   加減 + -
 *   乘除 * /
 *   一元負號 -
 *   括號 ( )
 *   函式呼叫 DOWN(x) UP(x) MUL(a,b) IS_GUN(x)
 *   特殊函式 WPT(WeaponTypeId) —— 參數是「裸識別字」，代表武器類型 id 字面值，不會被當成關鍵字解析
 *   數字字面值（含小數點）
 *   關鍵字（見 KEYWORDS，對應到 context 裡的數值）
 *
 * 語法來源對照 index.html 的 KeywordReplaceList（搜尋 KeywordReplaceList.push）。
 */
(function (global) {
    'use strict';

    var KEYWORDS = [
        'STR', 'AGI', 'VIT', 'INT', 'DEX', 'LUK', 'POW', 'STA', 'WIS', 'SPL', 'CON', 'CRT',
        'PATK', 'BLV', 'JLV', 'CHP', 'CSP', 'Mhp', 'Msp', 'SLV', 'AEI', 'WLV', 'WGT',
        'SRL', 'SHW', 'CRW', 'ELV', 'ESIZE', 'EVit',
    ];

    function FormulaError(message) {
        var err = new Error(message);
        err.name = 'FormulaError';
        return err;
    }

    function tokenize(src) {
        var tokens = [];
        var i = 0;
        var isDigit = function (c) { return c >= '0' && c <= '9'; };
        var isIdentStart = function (c) { return /[A-Za-z_]/.test(c); };
        var isIdentChar = function (c) { return /[A-Za-z0-9_]/.test(c); };

        while (i < src.length) {
            var c = src[i];
            if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
            if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
                var j = i;
                while (j < src.length && (isDigit(src[j]) || src[j] === '.')) j++;
                tokens.push({ type: 'num', value: parseFloat(src.slice(i, j)) });
                i = j;
                continue;
            }
            if (isIdentStart(c)) {
                var k = i;
                while (k < src.length && isIdentChar(src[k])) k++;
                tokens.push({ type: 'ident', value: src.slice(i, k) });
                i = k;
                continue;
            }
            if (c === '|' && src[i + 1] === '|') { tokens.push({ type: '||' }); i += 2; continue; }
            if (c === '&' && src[i + 1] === '&') { tokens.push({ type: '&&' }); i += 2; continue; }
            if (c === '>' && src[i + 1] === '=') { tokens.push({ type: '>=' }); i += 2; continue; }
            if (c === '<' && src[i + 1] === '=') { tokens.push({ type: '<=' }); i += 2; continue; }
            if (c === '=' && src[i + 1] === '=') { tokens.push({ type: '==' }); i += 2; continue; }
            if (c === '!' && src[i + 1] === '=') { tokens.push({ type: '!=' }); i += 2; continue; }
            if ('+-*/()?:,><'.indexOf(c) !== -1) { tokens.push({ type: c }); i++; continue; }
            throw FormulaError('無法識別的字元: "' + c + '" (position ' + i + ')');
        }
        tokens.push({ type: 'eof' });
        return tokens;
    }

    function truthy(v) {
        return v !== 0 && v !== false && v !== null && v !== undefined && !(typeof v === 'number' && isNaN(v));
    }

    var GUN_TYPES = ['Pistol', 'Rifle', 'Gatling', 'Shotgun', 'Grenade'];

    // 對應原本 MulOper(value, percent)：value * percent，percent>=1 無條件捨去、percent<1 無條件進位
    function mulOper(value, percent) {
        var _S = Math.round(value * (Number(percent) * 100));
        var _L = Math.floor(_S / 100);
        if (percent < 1 && _S % 100 !== 0) _L += 1;
        return _L;
    }

    function Parser(tokens, context) {
        this.tokens = tokens;
        this.pos = 0;
        this.context = context;
    }
    Parser.prototype.peek = function () { return this.tokens[this.pos]; };
    Parser.prototype.next = function () { return this.tokens[this.pos++]; };
    Parser.prototype.expect = function (type) {
        var t = this.next();
        if (t.type !== type) throw FormulaError('預期 "' + type + '" 但得到 "' + t.type + '"');
        return t;
    };

    Parser.prototype.parse = function () {
        var value = this.parseTernary();
        this.expect('eof');
        return value;
    };

    Parser.prototype.parseTernary = function () {
        var cond = this.parseOr();
        if (this.peek().type === '?') {
            this.next();
            var whenTrue = this.parseTernary();
            this.expect(':');
            var whenFalse = this.parseTernary();
            return truthy(cond) ? whenTrue : whenFalse;
        }
        return cond;
    };

    Parser.prototype.parseOr = function () {
        var left = this.parseAnd();
        while (this.peek().type === '||') {
            this.next();
            var right = this.parseAnd();
            left = (truthy(left) || truthy(right)) ? 1 : 0;
        }
        return left;
    };

    Parser.prototype.parseAnd = function () {
        var left = this.parseComparison();
        while (this.peek().type === '&&') {
            this.next();
            var right = this.parseComparison();
            left = (truthy(left) && truthy(right)) ? 1 : 0;
        }
        return left;
    };

    Parser.prototype.parseComparison = function () {
        var left = this.parseAdditive();
        var ops = ['>', '<', '>=', '<=', '==', '!='];
        while (ops.indexOf(this.peek().type) !== -1) {
            var op = this.next().type;
            var right = this.parseAdditive();
            switch (op) {
                case '>': left = (left > right) ? 1 : 0; break;
                case '<': left = (left < right) ? 1 : 0; break;
                case '>=': left = (left >= right) ? 1 : 0; break;
                case '<=': left = (left <= right) ? 1 : 0; break;
                case '==': left = (left === right) ? 1 : 0; break;
                case '!=': left = (left !== right) ? 1 : 0; break;
            }
        }
        return left;
    };

    Parser.prototype.parseAdditive = function () {
        var left = this.parseMultiplicative();
        while (this.peek().type === '+' || this.peek().type === '-') {
            var op = this.next().type;
            var right = this.parseMultiplicative();
            left = op === '+' ? left + right : left - right;
        }
        return left;
    };

    Parser.prototype.parseMultiplicative = function () {
        var left = this.parseUnary();
        while (this.peek().type === '*' || this.peek().type === '/') {
            var op = this.next().type;
            var right = this.parseUnary();
            left = op === '*' ? left * right : left / right;
        }
        return left;
    };

    Parser.prototype.parseUnary = function () {
        if (this.peek().type === '-') {
            this.next();
            return -this.parseUnary();
        }
        if (this.peek().type === '+') {
            this.next();
            return this.parseUnary();
        }
        return this.parsePrimary();
    };

    Parser.prototype.parsePrimary = function () {
        var t = this.peek();
        if (t.type === 'num') { this.next(); return t.value; }
        if (t.type === '(') {
            this.next();
            var value = this.parseTernary();
            this.expect(')');
            return value;
        }
        if (t.type === 'ident') {
            return this.parseIdentOrCall();
        }
        throw FormulaError('預期數值/識別字/括號，但得到 "' + t.type + '"');
    };

    Parser.prototype.parseIdentOrCall = function () {
        var name = this.next().value;

        if (this.peek().type === '(') {
            this.next(); // consume '('
            if (name === 'WPT') {
                var argTok = this.expect('ident');
                this.expect(')');
                return (this.context.weaponTypeId === argTok.value) ? 1 : 0;
            }
            if (name === 'DOWN') {
                var arg1 = this.parseTernary();
                this.expect(')');
                return Math.floor(arg1);
            }
            if (name === 'UP') {
                var arg2 = this.parseTernary();
                this.expect(')');
                return Math.ceil(arg2);
            }
            if (name === 'MUL') {
                var a = this.parseTernary();
                this.expect(',');
                var b = this.parseTernary();
                this.expect(')');
                return mulOper(a, b);
            }
            if (name === 'IS_GUN') {
                var argTok2 = this.expect('ident');
                this.expect(')');
                return GUN_TYPES.indexOf(argTok2.value) !== -1 ? 1 : 0;
            }
            throw FormulaError('未知函式: ' + name);
        }

        if (KEYWORDS.indexOf(name) === -1) {
            throw FormulaError('未知關鍵字: ' + name);
        }
        if (!(name in this.context)) {
            throw FormulaError('context 缺少關鍵字數值: ' + name);
        }
        return Number(this.context[name]);
    };

    function evaluateFormula(formula, context) {
        var tokens = tokenize(String(formula));
        var parser = new Parser(tokens, context);
        return parser.parse();
    }

    global.FormulaInterpreter = {
        evaluateFormula: evaluateFormula,
        KEYWORDS: KEYWORDS,
        mulOper: mulOper,
    };
})(typeof window !== 'undefined' ? window : this);
