// How much traffic disappeared where road space was taken: Table 1 of Cairns,
// Atkins and Goodwin, "Disappearing traffic? The story so far", Municipal
// Engineer 151 (2002), https://nacto.org/docs/usdg/disappearing_traffic_cairns.pdf
//
// Percent of the vehicles that used the street or area and were not found on it
// or on the streets around afterwards; below zero, traffic grew.
// Kinds: b - a bridge or tunnel shut, c - a town centre, l - a bus lane.
export const CASES = [
  [146.6, 'Norymberga, Rathausplatz, po 5 latach', 'c'],
  [108.5, 'Wiesbaden, śródmieście', 'c'],
  [87.5, 'Southampton, śródmieście', 'c'],
  [86.1, 'Norymberga, Rathausplatz, po roku', 'c'],
  [80.3, 'Londyn, Tower Bridge, po miesiącu', 'b'],
  [76.3, 'Londyn, Partingdale Lane, po 6 miesiącach', ''],
  [62.7, 'Londyn, tunel Rotherhithe, po miesiącu', 'b'],
  [61.3, 'Hobart, zawalony Tasman Bridge, po 14 miesiącach', 'b'],
  [52.7, 'Orpington, High Street, po 3 miesiącach', 'c'],
  [50.8, 'Bolonia, śródmieście, 1981–1989', 'c'],
  [48.2, 'Kobe, po trzęsieniu ziemi i odbudowie autostrad', ''],
  [46.0, 'Göteborg, śródmieście, 1970–1980', 'c'],
  [45.5, 'Nowy Jork, zamknięta autostrada, po 2 latach', ''],
  [41.9, 'Edmonton, Kinnaird Bridge, po 3 tygodniach', 'b'],
  [36.4, 'Nowy Jork, zamknięta autostrada, po roku', ''],
  [33.5, 'Londyn, Hammersmith Bridge, po miesiącu', 'b'],
  [33.0, 'Londyn, A13, jeden dzień', ''],
  [30.0, 'Londyn, Partingdale Lane, po 3 miesiącach', ''],
  [27.9, 'Londyn, A13, jeden dzień', ''],
  [27.8, 'Londyn, Oxford Street, 1. etap', 'c'],
  [25.0, 'Londyn, Ring of Steel, środek City', 'c'],
  [22.6, 'Londyn, A13, jeden dzień', ''],
  [19.8, 'Aarau, szczyt popołudniowy', ''],
  [18.2, 'Oksford, strategia transportowa, po roku', 'c'],
  [16.3, 'Hamm', 'c'],
  [15.9, 'York, Lendal Bridge, po miesiącu', 'b'],
  [14.5, 'Lüneburg', 'c'],
  [14.4, 'Wolverhampton, wewnątrz obwodnicy', 'c'],
  [14.0, 'Hobart, 5 miesięcy po odbudowie Tasman Bridge', ''],
  [13.0, 'Bolonia, śródmieście, 1972–1974', 'c'],
  [10.6, 'Leeds, pas dla pełnych aut, po miesiącu', ''],
  [10.6, 'Cambridge, Bridge Street, po 5 miesiącach', 'c'],
  [9.7, 'Oksford, buspasy, po roku', 'l'],
  [8.4, 'Cambridge, śródmieście, po 4 latach', 'c'],
  [7.5, 'San Francisco, po trzęsieniu ziemi i odbudowie', ''],
  [7.2, 'Londyn, A104, buspas, po roku', 'l'],
  [7.0, 'Fryburg, obwodnica śródmieścia, po 10 miesiącach', 'c'],
  [6.7, 'Oksford, centrum, po 10 latach', ''],
  [5.4, 'York, buspas, po 7 tygodniach', 'l'],
  [4.4, 'York, buspas, po tygodniu', 'l'],
  [4.3, 'Cardiff, buspasy', 'l'],
  [4.0, 'Göteborg, centrum, 1975–1980', 'c'],
  [3.3, 'Leicester, obwodnica, szczyt poranny', ''],
  [3.1, 'Edynburg, Princes Street, po 3 miesiącach', 'c'],
  [2.8, 'M4, buspas, po roku', 'l'],
  [1.7, 'Los Angeles, po trzęsieniu ziemi i odbudowie', ''],
  [1.7, 'Nottingham, ograniczenie wjazdu, po 9 miesiącach', ''],
  [1.2, 'Wolverhampton', 'c'],
  [0.3, 'Cambridge, Emmanuel Road, po 7 miesiącach', 'c'],
  [0.2, 'Londyn, Ring of Steel, całe City, po roku', 'c'],
  [0.1, 'Edynburg, Princes Street, po roku', 'c'],
  [0, 'Monachium, zamknięty most', 'b'],
  [-0.4, 'Londyn, Vauxhall Cross, po 3 miesiącach', ''],
  [-1.4, 'Orpington, High Street, po roku', 'c'],
  [-1.7, 'Frankfurt nad Menem, zamknięty most', 'b'],
  [-2.1, 'Londyn, Westminster Bridge', ''],
  [-2.3, 'M4, buspas, po 2 miesiącach', 'l'],
  [-3.0, 'Cambridge, Bridge Street, po 2 miesiącach', 'c'],
  [-3.3, 'Norwegia, przebudowy ulic', 'c'],
  [-6.0, 'Leicester, obwodnica, cały szczyt poranny', ''],
  [-13.8, 'Aarau, cała doba', ''],
  [-20.6, 'Anglia, obwodnice sześciu miast', ''],
  [-25.5, 'Leeds, pas dla pełnych aut, po 13 miesiącach', ''],
].map(([v, name, kind]) => ({ v, name, kind }))

export const KINDS = {
  b: { label: 'zamknięty most lub tunel', color: '#ff3b5c' },
  c: { label: 'śródmieście', color: '#4aa8ff' },
  l: { label: 'buspas', color: '#ffd166' },
  '': { label: 'inne', color: '#8b95a5' },
}

/** Shares to start from, and what they rest on. */
export const ASSUME = [
  { key: 0, note: 'nikt nie rezygnuje — najostrożniej' },
  { key: 5, note: 'mniej więcej tyle przy buspasach (mało przypadków)' },
  { key: 11, note: 'mediana wszystkich wyników' },
  { key: 14, note: 'mediana zmian w śródmieściach' },
  { key: 22, note: 'średnia, podbita przez kilka bardzo dużych spadków' },
]
export const MOST = 60      // the largest share to assume, percent

// `brief` - known from the abstract only
export const SOURCES = [
  {
    name: 'Cairns, Atkins, Goodwin 2002', url: 'https://nacto.org/docs/usdg/disappearing_traffic_cairns.pdf',
    says: 'ponad 70 przypadków z 11 krajów; mediana −10,6%, średnia −21,9%. Bywa, że ruch z czasem wraca; bywa, że dalej maleje.',
  },
  {
    name: 'Nello-Deakin 2022, Barcelona', url: 'https://ddd.uab.cat/record/269295?ln=en', brief: true,
    says: '11 ulic: −14,8% względem reszty miasta, na równoległych +0,7%.',
  },
  {
    name: 'Thomas, Aldred 2023, Londyn', brief: true,
    url: 'https://westminsterresearch.westminster.ac.uk/item/w6xqv/changes-in-motor-traffic-in-london-s-low-traffic-neighbourhoods-and-boundary-roads',
    says: '46 osiedli bez przejazdu na wylot: w środku mniej więcej o połowę mniej ruchu, na ulicach granicznych mała zmiana.',
  },
  {
    name: 'Bou Sleiman 2024, Paryż', url: 'https://conference.nber.org/conf_papers/f203605/f203605.pdf',
    says: 'przykład odwrotny: po zamknięciu 3,3 km bulwaru nad Sekwaną ruch na sąsiednich ulicach wzrósł o 26%, a prędkość na nich i na obwodnicy spadła o 16–18%.',
  },
]
