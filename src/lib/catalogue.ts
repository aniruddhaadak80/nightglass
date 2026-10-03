/**
 * Catalogue: the sealed offline sample, plus the normalisation contract that
 * live upstream rows must satisfy before the rest of the application sees them.
 *
 * Two things live here.
 *
 * 1. A bundled, curated J2000 catalogue. These positions are hand-checked
 *    against published J2000 coordinates rather than scraped, because a
 *    planner that points a telescope 20 arcminutes off is worse than no
 *    planner. It is always labelled `fallback` in the API response and never
 *    presented as live.
 *
 * 2. The type map and `normaliseObject` helper used to turn a VizieR CSV row
 *    into a `SkyObject`. Nothing downstream ever sees a raw upstream row.
 *
 * On epochs: VizieR's NGC/IC table (VII/1B) stores pre-J2000 positions, and its
 * `RA1975`/`DE1975` columns did not round-trip against known objects when
 * checked, so it is deliberately not used. The live source is the Bright Star
 * Catalogue (V/50), which stores J2000 directly and verified exactly against
 * reference values for Sirius, Canopus and Arcturus.
 */

import type { CatalogueSource, ObjectKind, SkyObject } from "./types";

export const VIZIER_ENDPOINT = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync";

export const BRIGHT_STAR_SOURCE: CatalogueSource = {
  id: "vizier-v50",
  label: "Bright Star Catalogue (CDS VizieR V/50)",
  attribution: "https://cdsarc.cds.unistra.fr/ftp/cats/V/50/",
  endpoint: VIZIER_ENDPOINT,
};

export const SAMPLE_SOURCE: CatalogueSource = {
  id: "nightglass-sample",
  label: "nightglass bundled J2000 sample",
  attribution: "https://github.com/aniruddhaadak80/nightglass",
  endpoint: "in-repository",
};

/** Bundled sample provenance: the date the coordinates were last reviewed. */
export const SAMPLE_REVIEWED = "2026-10-03";

/**
 * Numeric object-type codes used by the VizieR NGC/IC summary table.
 * Anything unmapped becomes "other" rather than being guessed at.
 */
const NGC_TYPE_CODES: Record<string, ObjectKind> = {
  "1": "galaxy",
  "2": "galaxy",
  "3": "galaxy",
  "4": "nebula",
  "5": "cluster",
  "6": "nebula",
  "7": "cluster",
  "8": "double",
  "9": "star",
};

export function kindFromNgTypeCode(code: unknown): ObjectKind {
  if (typeof code !== "string") return "other";
  return NGC_TYPE_CODES[code.trim()] ?? "other";
}

/* -------------------------------------------------------------------------- */
/* The bundled sample                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Bundled catalogue rows.
 *
 * `[id, name, designation, kind, raDeg, decDeg, magnitude, arcmin | null, blurb]`
 *
 * Ids are slugs of names or Messier/NGC numbers. Deliberately *not* HR numbers:
 * the Bright Star Catalogue supplies authoritative HR identifiers live from
 * VizieR, and inventing HR numbers here would put identifiers in the product
 * that cannot be checked against any catalogue.
 *
 * Positions are J2000 and were cross-checked against published values for the
 * named objects. This is the sealed offline sample: it is always reported as
 * `fallback`, never as live data.
 */
type SampleTuple = [
  string,
  string,
  string | null,
  ObjectKind,
  number,
  number,
  number,
  number | null,
  string,
];

const STARS: SampleTuple[] = [
  ["sirius", "Sirius", "α CMa", "star", 101.2872, -16.7161, -1.46, null, "The brightest star in the night sky, blazing white in Canis Major."],
  ["canopus", "Canopus", "α Car", "star", 95.988, -52.6957, -0.74, null, "Second brightest star in the sky, and the pole star of southern navigators."],
  ["rigil-kentaurus", "Rigil Kentaurus", "α Cen", "star", 219.9021, -60.834, -0.27, null, "Alpha Centauri, the nearest star system to the Sun at about 4.4 light-years."],
  ["arcturus", "Arcturus", "α Boo", "star", 213.9153, 19.1824, -0.05, null, "The brightest star in the northern hemisphere, an orange giant at the end of its life."],
  ["vega", "Vega", "α Lyr", "star", 279.2347, 38.7837, 0.03, null, "A blue-white beacon of the Summer Triangle, almost overhead in summer."],
  ["capella", "Capella", "α Aur", "star", 79.1723, 45.998, 0.08, null, "A close pair of yellow giants that never sets from mid northern latitudes."],
  ["rigel", "Rigel", "β Ori", "star", 78.6345, -8.2016, 0.13, null, "A blue supergiant marking the left corner of Orion's belt."],
  ["procyon", "Procyon", "α CMi", "star", 114.8255, 5.225, 0.34, null, "A nearby white subgiant that rises just ahead of Sirius."],
  ["achernar", "Achernar", "α Eri", "star", 24.4285, -57.2367, 0.46, null, "A rapidly spinning star flattened visibly into an oblate shape."],
  ["betelgeuse", "Betelgeuse", "α Ori", "star", 88.7929, 7.4071, 0.5, null, "The red supergiant on Orion's shoulder, variable and immense."],
  ["hadar", "Hadar", "β Cen", "star", 210.9559, -60.373, 0.61, null, "A triple system whose unequal members give it a blue-white cast."],
  ["altair", "Altair", "α Aql", "star", 297.6958, 8.8683, 0.76, null, "The southern point of the Summer Triangle, spinning close to flattening."],
  ["acrux", "Acrux", "α Cru", "star", 186.6496, -63.0991, 0.77, null, "The southernmost of the bright stars, at the foot of the Southern Cross."],
  ["aldebaran", "Aldebaran", "α Tau", "star", 68.9802, 16.5093, 0.85, null, "The orange eye of Taurus, a giant lying inside the Hyades."],
  ["spica", "Spica", "α Vir", "star", 201.2983, -11.1613, 1.04, null, "A close binary that the eye sees as a single blue-white point."],
  ["antares", "Antares", "α Sco", "star", 247.3519, -26.432, 1.09, null, "The red heart of Scorpius, a supergiant that pulses in brightness."],
  ["pollux", "Pollux", "β Gem", "star", 116.3289, 28.0262, 1.14, null, "An orange giant, the brighter half of the Castor and Pollux pair."],
  ["fomalhaut", "Fomalhaut", "α PsA", "star", 344.4127, -29.6222, 1.16, null, "A lonely bright star encircled by a striking ring of dust."],
  ["deneb", "Deneb", "α Cyg", "star", 310.358, 45.2803, 1.25, null, "The northern point of the Summer Triangle, about 2,500 light-years away."],
  ["mimosa", "Mimosa", "β Cru", "star", 191.9303, -59.6888, 1.25, null, "A hot multiple in the Southern Cross, just below its brightest star."],
  ["regulus", "Regulus", "α Leo", "star", 152.0929, 11.9672, 1.35, null, "The heart of the Sickle, spinning so fast it is visibly flattened."],
  ["adhara", "Adhara", "ε CMa", "star", 104.6565, -28.9721, 1.5, null, "A brilliant but searingly hot multiple, among the closest bright stars."],
  ["castor", "Castor", "α Gem", "star", 113.6495, 31.8883, 1.57, null, "A remarkable six-star system with two known exoplanets."],
  ["shaula", "Shaula", "λ Sco", "star", 263.4022, -37.1038, 1.62, null, "The stinger of Scorpius, a hot triple lying right on the ecliptic."],
  ["bellatrix", "Bellatrix", "γ Ori", "star", 81.2828, 6.3497, 1.64, null, "The blue-white shoulder of Orion, marking its left corner."],
  ["elnath", "Elnath", "β Tau", "star", 81.573, 28.6075, 1.65, null, "The Bull's northern horn, shared by Taurus and Auriga."],
  ["miaplacidus", "Miaplacidus", "β Car", "star", 138.2999, -69.7172, 1.67, null, "The second brightest star in Carina, deep in the southern sky."],
  ["alnilam", "Alnilam", "ε Ori", "star", 84.0534, -1.2019, 1.69, null, "The central and brightest star of Orion's belt."],
  ["alnitak", "Alnitak", "ζ Ori", "star", 85.1897, -1.9426, 1.74, null, "The eastern star of Orion's belt, a close multiple system."],
  ["regor", "Regor", "γ Vel", "star", 122.3833, -47.3367, 1.78, null, "A Wolf-Rayet star and one of the hottest stars visible to the eye."],
  ["avior", "Avior", "ε Car", "star", 125.6285, -59.5095, 1.86, null, "A short-lived blue giant in the keel of the Old Ship."],
  ["wezen", "Wezen", "δ CMa", "star", 107.0978, -26.3933, 1.83, null, "A yellow supergiant, the brightest star in the Great Dog's muzzle."],
  ["sargas", "Sargas", "θ Sco", "star", 264.3297, -42.9981, 1.86, null, "A bright giant along the Scorpion's curving body."],
  ["atria", "Atria", "α TrA", "star", 252.1662, -69.0277, 1.91, null, "The brightest star in the Southern Triangle."],
  ["kaus-australis", "Kaus Australis", "ε Sgr", "star", 276.043, -34.3846, 1.85, null, "The bright southern foot of the Archer's bow."],
  ["alsephina", "Alsephina", "δ Vel", "star", 131.1762, -54.7086, 1.96, null, "A hard blue star in the sails of Vela."],
  ["mirzam", "Mirzam", "β CMa", "star", 95.6749, -17.9559, 1.98, null, "The star at the nose of the Great Dog, rising just before Sirius."],
  ["polaris", "Polaris", "α UMi", "star", 37.9546, 89.2641, 1.98, null, "The north celestial pole star, sitting within a degree of the true pole."],
  ["aludra", "Aludra", "η CMa", "star", 111.0236, -29.3031, 2.45, null, "A blue supergiant at the tip of the Great Dog's tail."],
  ["saiph", "Saiph", "κ Ori", "star", 86.9391, -9.6696, 2.06, null, "Orion's right knee, a blue supergiant with a dust-depleted atmosphere."],
  ["alpheratz", "Alpheratz", "α And", "star", 2.097, 29.0904, 2.06, null, "The corner shared by Andromeda and Pegasus, an eclipsing binary."],
  ["mirach", "Mirach", "β And", "star", 17.4332, 35.6206, 2.06, null, "A red giant that doubles as a signpost to two nearby galaxies."],
  ["almach", "Almach", "γ And", "star", 30.9749, 42.3297, 2.1, null, "A superb golden double, arguably the finest in the autumn sky."],
  ["algol", "Algol", "β Per", "star", 47.0422, 40.9556, 2.12, null, "The Demon Star, dimming visibly every 2.87 days as a companion eclipses it."],
  ["schedar", "Schedar", "α Cas", "star", 10.1268, 56.5373, 2.24, null, "The brightest star in the W of Cassiopeia."],
  ["caph", "Caph", "β Cas", "star", 2.2945, 59.1498, 2.28, null, "An easy double at the western end of Cassiopeia's W."],
  ["denebola", "Denebola", "β Leo", "star", 177.2649, 14.5719, 2.14, null, "The tail of Leo, and a dependable seasonal marker."],
  ["algieba", "Algieba", "γ Leo", "star", 154.9931, 19.8417, 2.01, null, "A splendid golden double in the Lion's mane."],
  ["elebora", "Zosma", "δ Leo", "star", 168.5271, 20.5237, 2.56, null, "A wide, easy double on the back edge of the Sickle."],
  ["adulfa", "Adhafera", "ζ Leo", "star", 154.1731, 23.4172, 3.44, null, "A close triple that a small telescope can begin to split."],
  ["kochab", "Kochab", "β UMi", "star", 222.6763, 74.1555, 2.08, null, "A distinct orange star guarding the Little Dipper's bowl."],
  ["pherkad", "Pherkad", "γ UMi", "star", 230.1822, 71.834, 3.0, null, "The end of the Little Dipper's handle, furthest from Polaris."],
  ["thuban", "Thuban", "α Dra", "star", 211.0973, 64.3758, 3.65, null, "The pole star of ancient Egypt, four and a half thousand years ago."],
  ["eltanin", "Eltanin", "γ Dra", "star", 269.1517, 51.4889, 2.23, null, "The brightest star in the head of the Dragon, nearing the end of its life."],
  ["sadr", "Sadr", "γ Cyg", "star", 305.5571, 40.2567, 2.23, null, "The glowing heart of the Cygnus star cloud."],
  ["albireo", "Albireo", "β Cyg", "star", 292.6804, 27.9597, 3.18, 0.35, "The finest colour contrast double in the sky: gold beside sapphire."],
  ["gienah-cygni", "Gienah Cygni", "ε Cyg", "star", 311.5528, 33.9703, 2.48, null, "A wide double forming the near wing of the Swan."],
  ["rasalhague", "Rasalhague", "α Oph", "star", 263.7336, 12.56, 2.08, null, "A white giant rotating close to breakup speed, beside the serpent-bearer's head."],
  ["cebalrai", "Cebalrai", "β Oph", "star", 265.8682, 4.5673, 2.76, null, "The head of the serpent-bearer, a steady yellow giant."],
  ["yed-prior", "Yed Prior", "δ Oph", "star", 243.5861, -3.6942, 2.73, null, "A red subgiant that has already shed a planetary nebula."],
  ["sabik", "Sabik", "η Oph", "star", 257.5946, -15.725, 2.43, null, "A yellow giant escaping its system at high speed."],
  ["unukalhai", "Unukalhai", "α Ser", "star", 236.067, 6.4256, 2.63, null, "The brightest star in the head of the serpent."],
  ["sadalsuud", "Sadalsuud", "β Aqr", "star", 322.8896, -5.5711, 2.9, null, "The brightest star in Aquarius and a pulsating Cepheid variable."],
  ["sadalmelik", "Sadalmelik", "α Aqr", "star", 331.4458, -0.3197, 2.96, null, "A yellow supergiant marking Aquarius' shoulder."],
  ["skat", "Skat", "δ Aqr", "star", 343.6629, -15.8208, 3.27, null, "A low-mass A-type star near the tail of the Water Bearer."],
  ["deneb-algedi", "Deneb Algedi", "δ Cap", "star", 326.7605, -16.1273, 2.85, null, "An eclipsing binary, easily followed with the naked eye over hours."],
  ["nashira", "Nashira", "γ Cap", "star", 326.0527, -16.6623, 3.68, null, "The brightest of Capricornus' three alpha stars."],
  ["dabih", "Dabih", "β Cap", "star", 305.253, -14.7814, 3.05, null, "A tight golden double forming one of Capricorn's horns."],
  ["algedi", "Algedi", "α2 Cap", "star", 304.5134, -12.5447, 3.57, null, "An interacting binary closing out the constellation."],
  ["diphda", "Diphda", "β Cet", "star", 10.8968, -17.9866, 2.04, null, "The brightest star in the non-Ecliptic part of Cetus."],
  ["menkar", "Menkar", "α Cet", "star", 45.57, 4.0897, 2.53, null, "A red giant marking the open jaw of the Whale."],
  ["mira", "Mira", "ο Cet", "star", 34.8366, -2.9776, 3.04, null, "The prototype long-period variable, a pulsating red giant."],
  ["markab", "Markab", "α Peg", "star", 346.1902, 15.2053, 2.49, null, "The brightest corner of the Great Square of Pegasus."],
  ["scheat", "Scheat", "β Peg", "star", 345.9436, 28.0828, 2.42, null, "A red giant at the Great Square's most northerly corner."],
  ["algenib", "Algenib", "γ Peg", "star", 3.3088, 15.1836, 2.83, null, "The faintest corner of the Great Square, a young hot star."],
  ["enif", "Enif", "ε Peg", "star", 326.0465, 9.875, 2.38, null, "The nose of the flying horse, a pulsating supergiant."],
  ["rukab", "Ruchbah", "δ Cas", "star", 21.4538, 60.2353, 2.68, null, "A close double halfway along Cassiopeia's W."],
  ["segin", "Segin", "ε Cas", "star", 28.5988, 63.6701, 3.35, null, "The faintest star in Cassiopeia's W."],
  ["mirfak", "Mirfak", "α Per", "star", 51.0807, 49.8612, 1.79, null, "Alpha Persei, marking the Keystone of the hero."],
  ["alcyone", "Alcyone", "η Tau", "star", 56.8711, 24.1051, 2.87, null, "The brightest Pleiad, easily split by a small telescope."],
  ["atlas", "Atlas", "27 Tau", "star", 57.2878, 24.0534, 3.63, null, "A tight Pleiades pair that visibly drifts against the cluster."],
  ["electra", "Electra", "17 Tau", "star", 56.2189, 24.1131, 3.7, null, "One of the seven sisters, slightly south of the main line."],
  ["maia", "Maia", "20 Tau", "star", 56.4567, 24.3675, 3.87, null, "A runaway Pleiades star, noticeably bluer than the rest."],
  ["merope", "Merope", "23 Tau", "star", 56.5825, 23.9483, 4.14, null, "The lowest-contrast Pleiad, wrapped in blue reflection nebulosity."],
  ["taygeta", "Taygeta", "19 Tau", "star", 56.3022, 24.4672, 4.3, null, "A helium-rich Pleiad running hotter than its sisters."],
  ["mintaka", "Mintaka", "δ Ori", "star", 83.0016, -0.2991, 2.23, null, "The western star of Orion's belt, almost exactly on the celestial equator."],
  ["hatysa", "Hatysa", "ι Ori", "star", 83.8583, -5.9097, 2.77, null, "A young triple near Orion's sword."],
  ["meissa", "Meissa", "λ Ori", "star", 83.7845, 9.9342, 3.39, null, "The star at the very head of Orion."],
  ["naos", "Naos", "ζ Pup", "star", 120.8961, -40.0031, 2.25, null, "The brightest star of the Naos cluster, fiercely hot."],
  ["aspidiske", "Aspidiske", "ι Car", "star", 139.2725, -59.2753, 2.21, null, "A yellow-white giant in the keel of the ship."],
  ["markeb", "Markeb", "κ Vel", "star", 140.5281, -55.0107, 2.47, null, "A hot B-type subgiant in the sails of Vela."],
  ["turais", "Turais", "ρ Pup", "star", 155.3707, -24.3042, 2.81, null, "An orange giant near the stern of the ship."],
  ["muliphein", "Muliphein", "γ CMa", "star", 105.9397, -15.6333, 4.11, null, "A B1 supergiant blazing in the Great Dog."],
  ["tureis", "Tureis", "τ CMa", "star", 104.3424, -28.9837, 2.95, null, "A close double just south of Adhara."],
  ["wasat", "Wasat", "δ Gem", "star", 110.0308, 21.9823, 3.53, null, "A wide double marking the Twins' waists."],
  ["mebsuta", "Mebsuta", "ε Gem", "star", 100.9831, 25.1311, 2.98, null, "A variable and spectroscopic double in the Twins' heads."],
  ["mahasim", "Mahasim", "θ Aur", "star", 89.8822, 37.2125, 2.62, null, "A fine visual double in the Auriga pentagon."],
  ["menkalinan", "Menkalinan", "β Aur", "star", 89.8822, 44.9474, 1.9, null, "An eclipsing binary close beside Capella."],
  ["almaaz", "Almaaz", "ε Aur", "star", 75.4922, 43.8233, 2.99, null, "A long-period eclipsing variable in the Auriga pentagon."],
  ["hassaleh", "Hassaleh", "ι Aur", "star", 74.2483, 33.1661, 2.69, null, "A close double forming the foot of the Auriga pentagon."],
  ["izar", "Izar", "ε Boo", "star", 221.2467, 27.0742, 2.37, null, "A standout orange and blue double in the northern spring sky."],
  ["seginus", "Seginus", "γ Boo", "star", 218.0197, 38.3082, 3.03, null, "An eclipsing binary closing off the Kite in Bootes."],
  ["muphrid", "Muphrid", "η Boo", "star", 208.6717, 18.3977, 2.68, null, "A lone bright star lying alongside Arcturus's arc."],
  ["nekbar", "Nekkar", "β Boo", "star", 225.4867, 40.3906, 3.49, null, "A lonely star riding above Arcturus's shoulder."],
  ["alphecca", "Alphecca", "α CrB", "star", 233.672, 26.7147, 2.22, null, "The brightest star in the Northern Crown."],
  ["gemma", "Gemma", "γ CrB", "star", 235.6858, 26.2959, 3.84, null, "Splitting Alphecca into two is a classic test of your seeing."],
  ["nusakan", "Nusakan", "β CrB", "star", 231.9573, 29.1058, 3.66, null, "A close double in the Northern Crown."],
  ["kornephoros", "Kornephoros", "β Her", "star", 247.5553, 21.4896, 2.77, null, "The brightest member of the Keystone asterism in Hercules."],
  ["zeta-her", "Zeta Herculis", "ζ Her", "star", 250.3217, 31.6032, 2.81, null, "A close pair drifting steadily against the Keystone."],
  ["rasalgethi", "Rasalgethi", "α Her", "star", 258.662, 14.3903, 3.48, null, "A red giant that has swallowed a lower-mass companion."],
  ["sarin", "Sarin", "θ Her", "star", 247.5547, 37.6053, 3.86, null, "A double star set in the Keystone."],
  ["zubenelgenubi", "Zubenelgenubi", "α2 Lib", "star", 222.7197, -16.0418, 2.75, null, "The southern scale of Libra."],
  ["zubeneschamali", "Zubeneschamali", "β Lib", "star", 229.2517, -9.3828, 2.61, null, "The northern scale of Libra, an eclipsing binary."],
  ["alnair", "Alnair", "α Gru", "star", 332.0583, -46.9611, 1.74, null, "The bright tail of the Crane."],
  ["peacock", "Peacock", "α Pav", "star", 306.4117, -56.7351, 1.94, null, "A rare lambda Bootes star, an oddity that shines blue-white."],
  ["ankaa", "Ankaa", "α Phe", "star", 6.5708, -42.3061, 2.38, null, "An orange giant lying on the Southern Cross's long axis."],
  ["kraz", "Kraz", "γ Cen", "star", 190.3794, -48.9598, 2.17, null, "A star of unusual colour along the Centaurus crossbar."],
  ["dschubba", "Dschubba", "δ Sco", "star", 240.0833, -22.6217, 2.32, null, "A bright star close to the ecliptic, with a huge shadowing companion."],
  ["acrab", "Acrab", "β Sco", "star", 241.3592, -19.8054, 2.62, null, "A multiple star just beside the red supergiant Antares."],
  ["larawag", "Larawag", "ε Sco", "star", 252.5417, -34.2933, 2.29, null, "An orange giant near the Scorpion's sting."],
  ["fang", "Fang", "π Sco", "star", 239.713, -26.1141, 2.89, null, "The near companion of Dschubba."],
  ["rho-ophiuchi", "Rho Ophiuchi", "ρ Oph", "star", 245.2983, -21.5606, 4.15, null, "A striking multicoloured quadruple near Antares."],
  ["nunki", "Nunki", "σ Sgr", "star", 283.8164, -26.2967, 2.05, null, "The brightest star in the Teapot's lid."],
  ["kaus-media", "Kaus Media", "δ Sgr", "star", 275.2483, -29.8281, 2.7, null, "The middle of the Archer's bow, an unusual carbon star."],
  ["kaus-borealis", "Kaus Borealis", "λ Sgr", "star", 276.9931, -25.4217, 2.81, null, "A red giant marking the Teapot's raised spout."],
  ["ascella", "Ascella", "ζ Sgr", "star", 285.6531, -29.8803, 2.6, null, "An eclipsing binary just below the Teapot."],
  ["alnasl", "Alnasl", "γ2 Sgr", "star", 271.4528, -30.4242, 2.99, null, "A multiple system near the base of the Teapot."],
  ["homam", "Homam", "ζ Peg", "star", 340.3658, 10.8314, 3.4, null, "A triple system beside Markab in the Great Square."],
  ["biham", "Biham", "θ Peg", "star", 332.5492, 6.1978, 3.53, null, "A close double at the Great Square's eastern corner."],
  ["delta-and", "Delta Andromedae", "δ And", "star", 9.8317, 30.8611, 3.27, null, "An orange giant along the chain of Andromeda."],
  ["delta-her", "Delta Herculis", "δ Her", "star", 258.7583, 24.8394, 3.12, null, "A solar-like star in the Keystone of Hercules."],
  ["pleione", "Pleione", "28 Tau", "star", 57.2975, 24.1361, 5.05, null, "Long counted as a ninth sister, now resolved into a separate pair."],
  ["celeno", "Celeno", "16 Tau", "star", 56.1992, 24.2892, 5.45, null, "The faintest of the seven sisters."],
  ["atik", "Atik", "ζ Per", "star", 58.5333, 31.8836, 2.85, null, "An eclipsing binary in the Keystone of Perseus."],
  ["tabit", "Tabit", "π3 Ori", "star", 72.46, 6.9614, 3.19, null, "A close double lying on Orion's shield."],
  ["algenubi", "Algenubi", "ε Leo", "star", 146.4625, 23.7742, 2.98, null, "A wide, easy double in the Sickle of Leo."],
  ["yedd", "Yed", "ε Oph", "star", 244.5806, -4.6928, 3.23, null, "A yellow dwarf close beside Yed Prior."],
  ["han", "Han", "ζ Oph", "star", 249.2896, -10.5671, 2.56, null, "A close double in Ophiuchus."],
  ["phi-sgr", "Phi Sagittarii", "φ Sgr", "star", 281.4142, -26.9908, 3.17, null, "A multiple star in the base of the Teapot."],
];
const DEEP_SKY: SampleTuple[] = [
  ["M31", "Andromeda Galaxy", "NGC 224", "galaxy", 10.6847, 41.2691, 3.44, 178, "The nearest large spiral galaxy, and the most distant thing most people will ever see."],
  ["M33", "Triangulum Galaxy", "NGC 598", "galaxy", 23.4621, 30.6602, 5.72, 73, "A face-on spiral that rewards dark skies and averted vision."],
  ["M42", "Orion Nebula", "NGC 1976", "nebula", 83.8221, -5.3911, 4.0, 85, "The brightest nebula in the sky, a stellar nursery visible to the naked eye."],
  ["M45", "Pleiades", "Melotte 22", "cluster", 56.75, 24.1167, 1.6, 110, "An open cluster wrapped in blue reflection nebulosity; the seven sisters are naked-eye."],
  ["M13", "Hercules Cluster", "NGC 6205", "cluster", 250.4235, 36.4611, 5.8, 20, "Around 300,000 stars in a ball 145 light-years across."],
  ["M57", "Ring Nebula", "NGC 6720", "nebula", 283.3964, 33.0291, 8.8, 1.4, "A dying star's shed outer layers, visible as a tiny smoke ring."],
  ["M27", "Dumbbell Nebula", "NGC 6853", "nebula", 299.9016, 22.7211, 7.4, 8, "The first planetary nebula discovered, and the brightest."],
  ["M51", "Whirlpool Galaxy", "NGC 5194", "galaxy", 202.4696, 47.1952, 8.4, 11, "A grand-design spiral caught mid-interaction with its companion."],
  ["M81", "Bode's Galaxy", "NGC 3031", "galaxy", 148.8882, 69.0653, 6.94, 27, "A bright spiral, the easiest of the Ursa Major group."],
  ["M82", "Cigar Galaxy", "NGC 3034", "galaxy", 148.9685, 69.6797, 8.41, 11, "An edge-on starburst galaxy shaped by a close encounter with M81."],
  ["M104", "Sombrero Galaxy", "NGC 4594", "galaxy", 189.9976, -11.6231, 8.0, 9, "A brilliant dust lane and an enormous central bulge."],
  ["M1", "Crab Nebula", "NGC 1952", "nebula", 83.6331, 22.0145, 8.4, 6, "The wreckage of the supernova of 1054, still powered by a pulsar."],
  ["M8", "Lagoon Nebula", "NGC 6523", "nebula", 270.9042, -24.3867, 6.0, 90, "A vast emission nebula bisected by a dark dust lane."],
  ["M20", "Trifid Nebula", "NGC 6514", "nebula", 270.6229, -22.9714, 6.3, 28, "Three dust lanes splitting an emission region, in one eyepiece."],
  ["M16", "Eagle Nebula", "NGC 6611", "nebula", 274.7, -13.8067, 6.0, 35, "The Pillars of Creation stand inside this star-forming region."],
  ["M17", "Omega Nebula", "NGC 6618", "nebula", 275.1964, -16.1772, 6.0, 46, "The Swan, one of the brightest nebulae in the Milky Way."],
  ["M97", "Owl Nebula", "NGC 3587", "nebula", 168.6987, 55.0191, 9.9, 3.4, "A round planetary nebula whose eyes need a big aperture or dark skies."],
  ["M78", "C78", "NGC 2068", "nebula", 86.6906, 0.0794, 8.3, 8, "A reflection nebula north of Orion's belt, a ghost reflected starlight."],
  ["M11", "Wild Duck Cluster", "NGC 6705", "cluster", 282.7658, -6.27, 5.8, 14, "One of the richest open clusters in the sky, in a shape like a flight of ducks."],
  ["M22", "Sagittarius Cluster", "NGC 6656", "cluster", 279.1, -23.905, 5.1, 32, "A great globular low on the southern horizon from mid latitudes."],
  ["M5", "Rose Cluster", "NGC 5904", "cluster", 229.6379, 2.081, 5.65, 23, "A globular that resolves completely in a modest scope."],
  ["M15", "Great Pegasus Cluster", "NGC 7078", "cluster", 322.4933, 12.167, 6.2, 18, "A tight, highly concentrated globular near the Square of Pegasus."],
  ["M3", "M3", "NGC 5272", "cluster", 205.5483, 28.3773, 6.2, 18, "Half a million stars in a dense ball, superb in small scopes."],
  ["M35", "M35", "NGC 2168", "cluster", 111.0, 24.3333, 5.1, 28, "A bright, sprawling open cluster beside Gemini's feet."],
  ["M92", "M92", "NGC 6341", "cluster", 259.2808, 43.1363, 6.3, 14, "A concentrated globular, the sixth brightest in the sky."],
  ["M2", "M2", "NGC 7089", "cluster", 323.5, -0.8236, 6.3, 16, "A detached globular in Aquarius, one of the nearest."],
  ["M10", "M10", "NGC 6254", "cluster", 262.96, -4.1, 6.6, 20, "Paired with M12 across a degree of sky."],
  ["M12", "M12", "NGC 6218", "cluster", 260.5333, -1.9483, 6.7, 16, "A looser, older companion cluster to M10."],
  ["M4", "M4", "NGC 6121", "cluster", 245.8967, -26.5258, 5.9, 26, "The closest bright globular, only 7200 light-years away."],
  ["M6", "Butterfly Cluster", "NGC 6405", "cluster", 265.0833, -32.25, 4.2, 25, "A bright open cluster whose brighter stars trace butterfly wings."],
  ["M7", "Ptolemy Cluster", "NGC 6475", "cluster", 268.4633, -34.7933, 3.3, 80, "A naked-eye cluster with a bright core, above the Scorpion's sting."],
  ["M23", "M23", "NGC 6494", "cluster", 343.5, -18.9833, 5.5, 45, "A rich, uneven open cluster on the Milky Way."],
  ["M21", "M21", "NGC 6531", "cluster", 269.6333, -22.5, 5.9, 13, "A compact open cluster beside the Lagoon Nebula."],
  ["M24", "Sagittarius Star Cloud", "IC 4715", "cluster", 274.2, -18.55, 4.6, 90, "Not a cluster at all but a vast star cloud, one of the richest in the sky."],
  ["M25", "M25", "IC 4725", "cluster", 289.9333, -19.2333, 4.6, 32, "An open cluster that rewards a dark sky."],
  ["M55", "M55", "NGC 6809", "cluster", 295.0375, -30.9647, 6.3, 19, "A large southern globular with a shed halo of stars."],
  ["M54", "M54", "NGC 6715", "cluster", 283.3963, -18.7081, 7.6, 12, "A distant globular hiding among the Sagittarius star clouds."],
  ["M44", "Beehive Cluster", "NGC 2632", "cluster", 130.1, 19.6667, 3.7, 95, "A naked-eye smudge in Cancer that splinters in any telescope."],
  ["M41", "M41", "NGC 2287", "cluster", 67.75, -20.7167, 4.5, 38, "An open cluster just south of Sirius, unmistakable in a small scope."],
  ["M47", "M47", "NGC 2422", "cluster", 109.2, -6.2667, 4.2, 30, "One of the nearest open clusters, best in binoculars."],
  ["M46", "M46", "NGC 2437", "cluster", 111.5333, -14.8167, 6.1, 27, "A rich open cluster beside a ghostly planetary nebula."],
  ["M67", "M67", "NGC 2682", "cluster", 132.25, 7.4, 6.1, 30, "An ancient, metal-rich open cluster, a stellar fossil."],
  ["M83", "Southern Pinwheel Galaxy", "NGC 5236", "galaxy", 204.25, -29.8333, 7.5, 13, "A barred spiral with tightly wound arms and active star formation."],
  ["M77", "Cetus A", "NGC 1068", "galaxy", 40.2667, -0.05, 8.9, 7, "A Seyfert galaxy with an exceptionally bright active nucleus."],
  ["NGC253", "Sculptor Galaxy", "NGC 253", "galaxy", 11.8889, -25.2883, 7.1, 27, "A dusty starburst spiral seen almost edge-on."],
  ["NGC5128", "Centaurus A", "NGC 5128", "galaxy", 201.3652, -43.0191, 6.8, 26, "A giant elliptical bisected by a dark dust lane."],
  ["NGC7000", "North America Nebula", "NGC 7000", "nebula", 314.75, 44.3667, 4.0, 120, "A huge emission complex whose shape outlines a continent."],
  ["NGC6960", "Western Veil Nebula", "NGC 6960", "nebula", 311.75, 30.75, 7.0, 70, "Filaments from a supernova exploded 10,000 years ago."],
  ["NGC6992", "Eastern Veil Nebula", "NGC 6992", "nebula", 313.0, 31.75, 7.0, 60, "The other half of the Cygnus Loop, fainter and wider."],
  ["M101", "Pinwheel Galaxy", "NGC 5457", "galaxy", 210.8023, 54.3489, 7.9, 29, "A huge, low-contrast spiral needing a dark sky and averted vision."],
  ["M63", "Sunflower Galaxy", "NGC 5055", "galaxy", 198.9554, 42.0292, 8.6, 12.6, "A flocculent spiral with tightly wound patchy arms."],
  ["M64", "Black Eye Galaxy", "NGC 4826", "galaxy", 194.1821, 21.6827, 8.5, 10, "A spectacular dark dust band across its nucleus."],
  ["M65", "Leo Triplet member", "NGC 3623", "galaxy", 169.7333, 13.0922, 9.3, 8, "A faint, elongated spiral sharing the field with M66 and NGC 3627."],
  ["M66", "Leo Triplet member", "NGC 3627", "galaxy", 170.0625, 12.9917, 8.9, 9, "A barred spiral with a dramatic tidal tail."],
  ["NGC457", "Owl Cluster", "NGC 457", "cluster", 17.3433, 58.0833, 5.4, 13, "An oddly shaped open cluster, owl-like to the eye of the imagination."],
  ["NGC663", "NGC 663", "NGC 663", "cluster", 18.8667, 61.5, 7.1, 7, "A compact, colourful cluster in Cassiopeia beside the Bubble Nebula."],
  ["NGC752", "NGC 752", "NGC 752", "cluster", 29.2333, 37.8, 5.7, 75, "A large, loose, magpie-flecked open cluster in Andromeda."],
  ["NGC869", "h Persei", "NGC 869", "cluster", 34.74, 57.1333, 5.3, 30, "Half of the Double Cluster in Perseus, the densest naked-eye cluster."],
  ["NGC884", "Chi Persei", "NGC 884", "cluster", 35.57, 57.135, 6.1, 30, "The other half of the Double Cluster, even richer in stars."],
  ["IC434", "Horsehead Nebula", "IC 434", "nebula", 85.2458, -2.4583, 6.8, 60, "The dark silhouette of a horse's head against a glowing hydrogen cloud."],
  ["NGC2237", "Rosette Nebula", "NGC 2237", "nebula", 97.9792, 4.9417, 9.0, 80, "A vast circular flower of hydrogen with a bright central cluster."],
  ["IC2177", "Seagull Nebula", "IC 2177", "nebula", 106.9167, -9.5, 6.0, 120, "A head and wings of glowing gas, stretched over three degrees."],
];

const SAMPLE_ROWS: SampleTuple[] = [...STARS, ...DEEP_SKY];

export const SAMPLE_CATALOGUE: SkyObject[] = SAMPLE_ROWS.map(toSkyObject);

function toSkyObject(row: SampleTuple): SkyObject {
  const [id, name, designation, kind, raDeg, decDeg, magnitude, angularSizeArcmin, blurb] = row;
  return {
    id: `sample:${id}`,
    name,
    designation,
    kind,
    raDeg,
    decDeg,
    magnitude,
    angularSizeArcmin,
    constellation: null,
    blurb,
    sourceId: id,
    catalog: "nightglass bundled sample (J2000)",
  };
}

/** Deduplicate by id, keeping the first occurrence. */
function dedupe(objects: SkyObject[]): SkyObject[] {
  const seen = new Set<string>();
  const out: SkyObject[] = [];
  for (const o of objects) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}

export function sampleCatalogue(): SkyObject[] {
  return dedupe(SAMPLE_CATALOGUE.map((o) => ({ ...o })));
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

export interface NormaliseOptions {
  catalog: string;
  /** Epoch of the incoming coordinates, for the record. */
  epoch: string;
  /** Prepended to the id so two catalogues cannot collide. */
  idPrefix: string;
  /** Provide a name when the upstream row has none. */
  fallbackName: (sourceId: string) => string;
}

/**
 * Turn one parsed upstream row into a `SkyObject`, or return null when the row
 * is unusable.
 *
 * Returning null rather than a placeholder is deliberate: a row missing a
 * position cannot be ranked, and silently inventing one would put a target on
 * tonight's list that cannot actually be pointed at.
 */
export function normaliseObject(
  row: Record<string, string | undefined>,
  options: NormaliseOptions,
): SkyObject | null {
  const ra = Number(row.ra);
  const dec = Number(row.dec);
  const magnitude = Number(row.magnitude);

  if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(magnitude)) return null;
  if (ra < 0 || ra >= 360) return null;
  if (dec < -90 || dec > 90) return null;
  // Guard against a catalogued object that can never be seen anyway.
  if (magnitude > 12) return null;

  const sourceId = (row.sourceId ?? "").trim();
  if (!sourceId) return null;

  const sizeRaw = Number(row.size);
  const angularSizeArcmin =
    Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : null;

  return {
    id: `${options.idPrefix}:${sourceId}`,
    name: (row.name ?? "").trim() || options.fallbackName(sourceId),
    designation: (row.designation ?? "").trim() || null,
    kind: kindFromNgTypeCode(row.type),
raDeg: ra,
    decDeg: dec,
    magnitude,
    angularSizeArcmin,
    constellation: (row.constellation ?? "").trim() || null,
    blurb: (row.blurb ?? "").trim() || `${(row.name ?? sourceId).trim()} from ${options.catalog}.`,
    sourceId,
    catalog: `${options.catalog} (${options.epoch})`,
  };
}

export function mergeCatalogues(primary: SkyObject[], fallback: SkyObject[]): SkyObject[] {
  return dedupe([...primary, ...fallback]);
}