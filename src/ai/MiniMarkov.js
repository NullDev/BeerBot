// ========================= //
// = Copyright (c) NullDev = //
// ========================= //

/**
 * A minimal Markov chain text generator
 *
 * @class MicroMarkov
 */
class MicroMarkov {
    /**
     * Creates an instance of MicroMarkov.
     * @param {number} order
     * @memberof MicroMarkov
     */
    constructor(order){
        this.order = Math.max(2, Math.min(4, order));
        this.next = new Map();
    }

    /**
     * Train the model with given text
     *
     * @param {string} text
     * @return {void}
     * @memberof MicroMarkov
     */
    train(text){
        const toks = text.toLowerCase().replace(/[^\p{L}\p{N}'_\-\s]/gu, " ").split(/\s+/).filter(Boolean);
        if (toks.length <= this.order) return;
        const pad = Array(this.order - 1).fill("<s>");
        const seq = [...pad, ...toks, "</s>"];
        for (let i = 0; i + this.order - 1 < seq.length - 1; i++){
            const prefix = seq.slice(i, i + this.order - 1).join("\u0001");
            const next = seq[i + this.order - 1];
            if (!this.next.has(prefix)) this.next.set(prefix, new Map());
            const m = this.next.get(prefix);
            m.set(next, (m.get(next) ?? 0) + 1);
        }
    }

    /**
     * Sample a sentence from the model
     *
     * @param {number} [maxLen=160]
     * @param {number} [temperature=0.5]
     * @return {string}
     * @memberof MicroMarkov
     */
    sample(maxLen = 160, temperature = 0.5){
        let prefixTokens = Array(this.order - 1).fill("<s>");
        const acc = [];
        const maxSteps = 64;
        for (let steps = 0; steps < maxSteps; steps++){
            const key = prefixTokens.join("\u0001");
            const row = this.next.get(key);
            if (!row) break;
            const next = this.sampleRow([...row.entries()], temperature);
            if (!next || next === "</s>") break;
            if (next !== "<s>") acc.push(next);
            prefixTokens = [...prefixTokens.slice(1), next];
            if (acc.join(" ").length >= maxLen) break;
        }
        return acc.join(" ");
    }

    /**
     * Sample a next token from a row of [token, count] pairs with temperature
     *
     * @param {Array<any[]>} row
     * @param {number} [temperature=0.5]
     * @return {string|null}
     * @memberof MicroMarkov
     */
    sampleRow(row, temperature = 0.5){
        if (!row.length) return null;
        const pow = (/** @type {number} */ x) => Math.pow(x, 1 / Math.max(0.05, temperature));
        const weights = row.map(([, c]) => pow(c));
        const sum = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * sum;
        for (let i = 0; i < row.length; i++){
            r -= weights[i];
            if (r <= 0) return row[i][0];
        }
        return row[row.length - 1][0];
    }
}

export default MicroMarkov;
