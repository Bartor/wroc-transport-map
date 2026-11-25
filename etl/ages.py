"""How old the people of an age band are on average.

The survey asked for a band only, and the upper ones are wide: women over 60,
men over 65. What a band averages comes from everyone in it: people by sex and
five-year group on 31 December 2023, GUS Local Data Bank, subject P2137, for
the city of Wrocław (030210564011) and, for those around it, the powiat
wrocławski (030210423000). Within a group ages are taken as even.
"""

import functools

FROM = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85]
TO = FROM[1:] + [93]        # the last is open: about 89 on average

PEOPLE = {
    ("wro", "mężczyzna"): [16196, 14716, 12123, 12674, 25110, 32720, 33487, 30537, 23952, 17736,
                           13903, 14417, 17610, 15476, 9436, 4969, 5229],
    ("wro", "kobieta"): [15235, 14021, 12083, 13515, 27797, 33822, 33196, 29935, 24851, 18225,
                         15369, 17938, 23787, 23399, 15162, 9713, 12983],
    ("out", "mężczyzna"): [7531, 6768, 5312, 3805, 4176, 6487, 9064, 9602, 8269, 6029,
                           4399, 4202, 4314, 3217, 1719, 705, 571],
    ("out", "kobieta"): [7300, 6454, 5218, 3653, 4349, 7298, 9476, 9655, 8044, 5804,
                         4244, 4531, 4815, 4092, 2178, 1282, 1562],
}
SEXES = ["kobieta", "mężczyzna"]
# in completed years: both ends included
BANDS = {
    "6-15 lat": (6, 15), "16-19 lat": (16, 19), "20-24 lata": (20, 24), "25-44 lata": (25, 44),
    "45-60 lat (K) i 45-65 lat (M)": {"kobieta": (45, 60), "mężczyzna": (45, 65)},
    "pow. 60 lat (K) i pow. 65 lat (M)": {"kobieta": (61, 200), "mężczyzna": (66, 200)},
}


def moments(where, sex, low, high):
    """How many people, their mean age, and its variance."""
    n = s = q = 0.0
    for a, b, k in zip(FROM, TO, PEOPLE[where, sex]):
        x, y = max(a, low), min(b, high + 1)
        if x >= y:
            continue
        w = k * (y - x) / (b - a)
        n, s = n + w, s + w * (x + y) / 2
        q += w * (x * x + x * y + y * y) / 3
    m = s / n
    return n, m, q / n - m * m


@functools.lru_cache(None)
def of(band, sex, where):
    """Mean age and variance of a band; of both sexes together for the rest."""
    parts = []
    for s in [sex] if sex in SEXES else SEXES:
        b = BANDS[band]
        parts.append(moments(where, s, *(b[s] if isinstance(b, dict) else b)))
    n = sum(p[0] for p in parts)
    m = sum(p[0] * p[1] for p in parts) / n
    return m, sum(p[0] * (p[2] + p[1] ** 2) for p in parts) / n - m * m


def of_all(where, low=6):
    """Everyone of this age and more, to check against."""
    parts = [moments(where, s, low, 200) for s in SEXES]
    return sum(p[0] * p[1] for p in parts) / sum(p[0] for p in parts)


if __name__ == "__main__":
    for w in ("wro", "out"):
        for b in BANDS:
            print(w, b, *("%s %.1f" % (s[0], of(b, s, w)[0]) for s in SEXES))
        print(w, "6 and more: %.1f" % of_all(w))
