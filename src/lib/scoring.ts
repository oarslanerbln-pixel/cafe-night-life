/**
 * Round scoring and ranking. Pure functions only, so the host screen can re-run them
 * whenever a verdict is toggled and every dependent number (uniqueness, totals, ranks) stays consistent.
 */

export const SCORING = {
    unique: 20, // valid answer nobody else gave
    shared: 10, // valid answer at least one other player also gave
    speedBonus: 15, // first player to send early
} as const;

export type AnswerStatus = 'unique' | 'shared' | 'blank' | 'wrong-letter' | 'rejected';

export type Submission = {
    playerId: string;
    /** Raw `answers.data`: category -> text, plus the `_earlySubmit` flag. Rows must be in submission order. */
    data: Record<string, string>;
};

/** Host verdicts that override the automatic one, keyed by `overrideKey`. true = accept, false = reject. */
export type Overrides = Record<string, boolean>;

export type ScoredAnswer = {
    value: string;
    status: AnswerStatus;
    points: number;
    valid: boolean;
    /** The host flipped the automatic verdict. */
    overridden: boolean;
};

export type PlayerRound = {
    playerId: string;
    answers: Record<string, ScoredAnswer>;
    answerPoints: number;
    speedBonus: boolean;
    roundScore: number;
    uniqueCount: number;
    blankCount: number;
};

export const overrideKey = (playerId: string, category: string) => `${playerId}::${category}`;

// ß and the Turkish letters NFD can't decompose; umlauts and other accents are stripped below
const FOLD: Record<string, string> = { 'ß': 'ss', 'ç': 'c', 'ğ': 'g', 'ı': 'i', 'ş': 's' };

/**
 * Canonical form used to compare answers and check the starting letter: case, spacing, umlauts and
 * accents don't matter ("Straße" == "strasse ", "Äpfel" counts for A), because phone keyboards differ.
 */
export function normalizeAnswer(raw: string): string {
    return raw
        .trim()
        .replace(/\s+/g, ' ')
        .toLocaleLowerCase('de-DE')
        .replace(/[ßçğış]/g, ch => FOLD[ch])
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

type ScoreRoundInput = {
    categories: string[];
    letter: string;
    submissions: Submission[];
    playerIds: string[];
    overrides?: Overrides;
};

export function scoreRound({ categories, letter, submissions, playerIds, overrides = {} }: ScoreRoundInput): PlayerRound[] {
    const normLetter = normalizeAnswer(letter);

    // One row per player (first wins), kept in submission order so "first early sender" is well defined
    const byPlayer = new Map<string, Record<string, string>>();
    let speedWinner: string | null = null;
    for (const s of submissions) {
        if (byPlayer.has(s.playerId)) continue;
        byPlayer.set(s.playerId, s.data);
        if (speedWinner === null && s.data._earlySubmit === 'true') speedWinner = s.playerId;
    }

    type Cell = { value: string; norm: string; autoValid: boolean; valid: boolean; overridden: boolean };
    const cells = new Map<string, Record<string, Cell>>();
    const groupSize: Record<string, Map<string, number>> = {};
    categories.forEach(cat => { groupSize[cat] = new Map(); });

    for (const playerId of playerIds) {
        const data = byPlayer.get(playerId) ?? {};
        const row: Record<string, Cell> = {};
        for (const cat of categories) {
            const value = (data[cat] ?? '').trim();
            const norm = normalizeAnswer(value);
            const autoValid = norm !== '' && norm.startsWith(normLetter);
            const forced = overrides[overrideKey(playerId, cat)];
            const valid = norm !== '' && (forced ?? autoValid);
            row[cat] = { value, norm, autoValid, valid, overridden: forced !== undefined && forced !== autoValid };
            if (valid) groupSize[cat].set(norm, (groupSize[cat].get(norm) ?? 0) + 1);
        }
        cells.set(playerId, row);
    }

    return playerIds.map(playerId => {
        const row = cells.get(playerId)!;
        const answers: Record<string, ScoredAnswer> = {};
        let answerPoints = 0;
        let uniqueCount = 0;
        let blankCount = 0;

        for (const cat of categories) {
            const c = row[cat];
            let status: AnswerStatus;
            let points = 0;
            if (c.norm === '') {
                status = 'blank';
                blankCount++;
            } else if (c.valid) {
                const unique = groupSize[cat].get(c.norm) === 1;
                status = unique ? 'unique' : 'shared';
                points = unique ? SCORING.unique : SCORING.shared;
                if (unique) uniqueCount++;
            } else {
                status = c.autoValid ? 'rejected' : 'wrong-letter';
            }
            answers[cat] = { value: c.value, status, points, valid: c.valid, overridden: c.overridden };
            answerPoints += points;
        }

        const speedBonus = playerId === speedWinner;
        return {
            playerId,
            answers,
            answerPoints,
            speedBonus,
            roundScore: answerPoints + (speedBonus ? SCORING.speedBonus : 0),
            uniqueCount,
            blankCount,
        };
    });
}

export type Rankable = { id: string; name: string; total: number; tiebreak: number };

/**
 * Sorts by total, then tiebreak (e.g. unique answers), then name. Players with equal totals
 * share a rank (1, 2, 2, 4), so a tie is never presented as one player beating the other.
 */
export function rankStandings<T extends Rankable>(entries: T[]): (T & { rank: number })[] {
    const sorted = [...entries].sort((a, b) =>
        b.total - a.total || b.tiebreak - a.tiebreak || a.name.localeCompare(b.name, 'de'));
    return sorted.map((e, i) => {
        const firstTied = sorted.findIndex(x => x.total === e.total);
        return { ...e, rank: firstTied === i ? i + 1 : firstTied + 1 };
    });
}
