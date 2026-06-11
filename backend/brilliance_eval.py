"""
Shared eval helpers for the Brilliance Engine pipeline.
All stored centipawn scores use white POV (+ = white better).
Gates that depend on mover perspective convert via to_mover_cp().
"""
import chess
import chess.engine

MATE_SCORE = 10000
EVAL_PERSPECTIVE = "white"

# Per-search movetime caps (seconds). Engine stops at depth OR time, whichever comes first.
STAGE2_SEARCH_TIME_S = 2.0
STAGE3_DEPTH_CURVE_TIME_S = 0.75
STAGE3_SEARCH_TIME_S = 1.5


def engine_limit(*, depth=None, time_s=2.0):
    kwargs = {"time": time_s}
    if depth is not None:
        kwargs["depth"] = depth
    return chess.engine.Limit(**kwargs)


def cp_from_info_white(info):
    if not info or "score" not in info:
        return None
    return info["score"].white().score(mate_score=MATE_SCORE)


def to_mover_cp(white_cp, color):
    if white_cp is None:
        return None
    return white_cp if color == chess.WHITE else -white_cp


def cpl_from_white_scores(best_white_cp, our_white_cp, color):
    if best_white_cp is None or our_white_cp is None:
        return 9999
    if color == chess.WHITE:
        return best_white_cp - our_white_cp
    return our_white_cp - best_white_cp


def cp_to_ep(cp):
    if cp is None:
        return 0.0
    return 1 / (1 + 10 ** (-cp / 400))


def linear_slope(xs, ys):
    n = len(xs)
    if n < 2:
        return 0.0
    mx = sum(xs) / n
    my = sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = sum((x - mx) ** 2 for x in xs)
    return num / den if den else 0.0


def variance(vals):
    if not vals:
        return 0.0
    m = sum(vals) / len(vals)
    return sum((v - m) ** 2 for v in vals) / len(vals)
