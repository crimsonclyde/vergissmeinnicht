import type { ComponentType } from 'react';
import {
  IconAirConditioning,
  IconAlarm,
  IconAlarmSmoke,
  IconAlertTriangle,
  IconAmbulance,
  IconApple,
  IconArchive,
  IconAxe,
  IconBabyBottle,
  IconBabyCarriage,
  IconBalloon,
  IconBarbell,
  IconBasket,
  IconBath,
  IconBattery,
  IconBeach,
  IconBed,
  IconBeer,
  IconBellRinging,
  IconBike,
  IconBlender,
  IconBolt,
  IconBook,
  IconBowl,
  IconBox,
  IconBoxMultiple,
  IconBread,
  IconBriefcase,
  IconBrush,
  IconBucketDroplet,
  IconBug,
  IconBuilding,
  IconBuildingHospital,
  IconBuildingWarehouse,
  IconBulb,
  IconBus,
  IconCalendar,
  IconCamera,
  IconCamper,
  IconCandle,
  IconCar,
  IconCarrot,
  IconCash,
  IconCat,
  IconCertificate,
  IconChargingPile,
  IconChecklist,
  IconChefHat,
  IconChristmasTree,
  IconCircleDashed,
  IconClipboardCheck,
  IconClock,
  IconCloudRain,
  IconCloudSnow,
  IconCloudStorm,
  IconCloudUpload,
  IconCoffee,
  IconCooker,
  IconCreditCard,
  IconDatabase,
  IconDental,
  IconDeviceCctv,
  IconDeviceDesktop,
  IconDeviceFloppy,
  IconDeviceLaptop,
  IconDeviceMobile,
  IconDeviceTablet,
  IconDeviceTv,
  IconDog,
  IconDogBowl,
  IconDoor,
  IconDoorExit,
  IconDroplet,
  IconEPassport,
  IconEgg,
  IconEngine,
  IconFaceMask,
  IconFence,
  IconFileText,
  IconFingerprint,
  IconFireExtinguisher,
  IconFirstAidKit,
  IconFish,
  IconFlag,
  IconFlame,
  IconFlower,
  IconFolder,
  IconFridge,
  IconFriends,
  IconGardenCart,
  IconGasStation,
  IconGauge,
  IconGift,
  IconGlassFull,
  IconGrill,
  IconHammer,
  IconHammerDrill,
  IconHanger,
  IconHeadphones,
  IconHeart,
  IconHeartbeat,
  IconHelmet,
  IconHome,
  IconHomeCog,
  IconHomeLock,
  IconHomeMove,
  IconHorse,
  IconHourglass,
  IconId,
  IconIroning,
  IconKey,
  IconLadder,
  IconLamp,
  IconLawnMower,
  IconLeaf,
  IconLeaf2,
  IconLifebuoy,
  IconListCheck,
  IconLock,
  IconLuggage,
  IconMail,
  IconMailbox,
  IconMap,
  IconMessage,
  IconMicrowave,
  IconMilk,
  IconMoon,
  IconMotorbike,
  IconMountain,
  IconMusic,
  IconNeedleThread,
  IconPackage,
  IconPaint,
  IconPaperBag,
  IconParking,
  IconPassword,
  IconPaw,
  IconPhone,
  IconPill,
  IconPizza,
  IconPlane,
  IconPlant,
  IconPool,
  IconPrinter,
  IconPuzzle,
  IconReceipt,
  IconReceiptTax,
  IconRecycle,
  IconRefresh,
  IconRepeat,
  IconRocket,
  IconRouter,
  IconRuler2,
  IconRun,
  IconSchool,
  IconScooter,
  IconSeedling,
  IconServer,
  IconSettings,
  IconShield,
  IconShip,
  IconShoppingBag,
  IconShoppingCart,
  IconShovel,
  IconSignature,
  IconSmartHome,
  IconSnowflake,
  IconSofa,
  IconSolarPanel,
  IconSpeakerphone,
  IconSpray,
  IconStairs,
  IconStar,
  IconStethoscope,
  IconSun,
  IconTag,
  IconTarget,
  IconTent,
  IconThermometer,
  IconTicket,
  IconToiletPaper,
  IconTool,
  IconTools,
  IconToolsKitchen2,
  IconTrain,
  IconTrash,
  IconTree,
  IconTrophy,
  IconTruck,
  IconUmbrella,
  IconUserMinus,
  IconUserPlus,
  IconUsers,
  IconVaccine,
  IconVacuumCleaner,
  IconWallet,
  IconWashMachine,
  IconWashTumbleDry,
  IconWheel,
  IconWheelchair,
  IconWifi,
  IconWind,
  IconWindow,
  IconWorld,
} from '@tabler/icons-react';
import type { ProcedureIcon as VmnIconKey } from './api.ts';
import { CURATED_TABLER_TAGS, GENERATED_ICONS } from './icon-catalog.generated.ts';
import {
  BoilerArt,
  ChimneyArt,
  DishwasherArt,
  FanArt,
  FuseBoxArt,
  GasBottleArt,
  RadiatorArt,
  ShowerArt,
  ShutterArt,
  SinkArt,
  ValveArt,
  type IconArtProps,
} from './icon-art.tsx';
import { hasMessage, t, type MessageKey } from './i18n/index.ts';

/**
 * The central icon registry (with the generated Tabler part, the only place that imports icon artwork). Procedures, Steps, Runs and
 * exported files store stable VMN icon keys (`PROCEDURE_ICONS`, e.g. "freezer"), never artwork or a
 * library component name; this maps each key to its artwork (Tabler Icons, MIT — one outline style,
 * `currentColor`, so every theme colours it), its picker category and English search words.
 * Two parts: the hand-written entries below (labels are messages `icon.<key>`, also drawn artwork for
 * household topics Tabler lacks) and several hundred Tabler icons generated from `icon-selection.json`
 * and Tabler's metadata (`icon-catalog.generated.ts`, `pnpm --filter @vergissmeinnicht/web icons:generate`).
 */
export type IconArt = ComponentType<IconArtProps>;

export type IconGroupKey = 'sport' | 'clothing' | 'places' | 'tasks' | 'home' | 'access' | 'utilities' | 'kitchen' | 'bathroom' | 'cleaning' | 'garden' | 'vehicles' | 'travel' | 'safety' | 'security' | 'tools' | 'documents' | 'shopping' | 'food' | 'animals' | 'tech' | 'communication' | 'people' | 'health' | 'weather' | 'storage' | 'waste' | 'misc';

interface CuratedIconEntry {
  readonly art: IconArt;
  readonly group: IconGroupKey;
  /** Extra search words (aliases), e.g. "plug electricity" for Power. */
  readonly keywords: string;
}

/** An entry of `icon-catalog.generated.ts`. */
export interface GeneratedIconEntry {
  readonly art: IconArt;
  readonly group: IconGroupKey;
  /** English label (a message `icon.<key>` overrides it). */
  readonly label: string;
  /** Search words chosen for VMN (strong). */
  readonly aliases: string;
  /** Tabler's tags (weaker search words). */
  readonly tags: string;
}

type GeneratedKey = keyof typeof GENERATED_ICONS;

// Keep one entry per line as `  key: { art: …,` — the generator reads these lines.
const CURATED_ICONS: Readonly<Record<Exclude<VmnIconKey, GeneratedKey>, CuratedIconEntry>> = {
  // Tasks & time
  checklist: { art: IconChecklist, group: 'tasks', keywords: 'list todo tasks check routine' },
  list: { art: IconListCheck, group: 'tasks', keywords: 'tasks todo items' },
  clipboard: { art: IconClipboardCheck, group: 'tasks', keywords: 'inspection review check audit' },
  star: { art: IconStar, group: 'tasks', keywords: 'favourite favorite important' },
  flag: { art: IconFlag, group: 'tasks', keywords: 'milestone goal mark' },
  target: { art: IconTarget, group: 'tasks', keywords: 'goal aim focus' },
  clock: { art: IconClock, group: 'tasks', keywords: 'time hour' },
  calendar: { art: IconCalendar, group: 'tasks', keywords: 'date schedule appointment day' },
  repeat: { art: IconRepeat, group: 'tasks', keywords: 'recurring routine again daily weekly monthly' },
  hourglass: { art: IconHourglass, group: 'tasks', keywords: 'timer wait deadline countdown' },
  alarm: { art: IconAlarm, group: 'tasks', keywords: 'alarm clock wake up morning' },
  reminder: { art: IconBellRinging, group: 'tasks', keywords: 'notification bell alert remind' },
  // Home
  home: { art: IconHome, group: 'home', keywords: 'house flat apartment' },
  building: { art: IconBuilding, group: 'home', keywords: 'apartment block flat office' },
  bed: { art: IconBed, group: 'home', keywords: 'bed sleep' },
  sofa: { art: IconSofa, group: 'home', keywords: 'sofa couch lounge' },
  lamp: { art: IconLamp, group: 'home', keywords: 'light reading lamp' },
  stairs: { art: IconStairs, group: 'home', keywords: 'steps staircase stairwell' },
  fence: { art: IconFence, group: 'home', keywords: 'yard boundary' },
  'smart-home': { art: IconSmartHome, group: 'home', keywords: 'automation home assistant' },
  moving: { art: IconHomeMove, group: 'home', keywords: 'move relocation removal' },
  // Doors, windows & keys
  door: { art: IconDoor, group: 'access', keywords: 'entrance access front door' },
  'door-exit': { art: IconDoorExit, group: 'access', keywords: 'exit leave go out' },
  shutter: { art: ShutterArt, group: 'access', keywords: 'roller shutter shutters blinds window' },
  window: { art: IconWindow, group: 'access', keywords: 'windows close open ventilate air' },
  key: { art: IconKey, group: 'access', keywords: 'key access lock' },
  // Utilities
  power: { art: IconBolt, group: 'utilities', keywords: 'electricity electric plug socket energy current fuse' },
  water: { art: IconDroplet, group: 'utilities', keywords: 'plumbing tap faucet pipe' },
  gas: { art: GasBottleArt, group: 'utilities', keywords: 'gas supply cylinder bottle propane boiler valve' },
  heating: { art: IconFlame, group: 'utilities', keywords: 'heater radiator boiler warm fire thermostat furnace' },
  chimney: { art: ChimneyArt, group: 'utilities', keywords: 'fireplace stove soot sweep smoke fire' },
  fan: { art: FanArt, group: 'utilities', keywords: 'fan ventilator ventilation lüfter air cooling blower' },
  radiator: { art: RadiatorArt, group: 'utilities', keywords: 'heating heater radiator warm bleed' },
  boiler: { art: BoilerArt, group: 'utilities', keywords: 'water heater hot water heating tank furnace' },
  'fuse-box': { art: FuseBoxArt, group: 'utilities', keywords: 'fuse fuses breaker circuit electricity power consumer unit' },
  valve: { art: ValveArt, group: 'utilities', keywords: 'stopcock shut-off main pipe plumbing water gas' },
  cooling: { art: IconAirConditioning, group: 'utilities', keywords: 'ac cooling cool fan climate' },
  lights: { art: IconBulb, group: 'utilities', keywords: 'light bulb lamp' },
  meter: { art: IconGauge, group: 'utilities', keywords: 'meter gauge counter reading' },
  solar: { art: IconSolarPanel, group: 'utilities', keywords: 'solar photovoltaic pv energy' },
  battery: { art: IconBattery, group: 'utilities', keywords: 'charge batteries' },
  'ev-charging': { art: IconChargingPile, group: 'utilities', keywords: 'electric car charger wallbox plug' },
  internet: { art: IconWorld, group: 'utilities', keywords: 'web online' },
  wifi: { art: IconWifi, group: 'utilities', keywords: 'wireless network wlan' },
  // Kitchen
  kitchen: { art: IconChefHat, group: 'kitchen', keywords: 'cooking cook recipe chef' },
  fridge: { art: IconFridge, group: 'kitchen', keywords: 'refrigerator cooler' },
  freezer: { art: IconSnowflake, group: 'kitchen', keywords: 'freeze frozen fridge refrigerator ice defrost' },
  stove: { art: IconCooker, group: 'kitchen', keywords: 'cooker oven hob pot' },
  microwave: { art: IconMicrowave, group: 'kitchen', keywords: 'oven' },
  blender: { art: IconBlender, group: 'kitchen', keywords: 'mixer smoothie' },
  dishwasher: { art: DishwasherArt, group: 'kitchen', keywords: 'dishwasher dishes washing up' },
  dishes: { art: IconBowl, group: 'kitchen', keywords: 'dishwasher washing up bowl plates' },
  grill: { art: IconGrill, group: 'kitchen', keywords: 'barbecue bbq' },
  // Bathroom
  shower: { art: ShowerArt, group: 'bathroom', keywords: 'shower wash' },
  sink: { art: SinkArt, group: 'bathroom', keywords: 'tap faucet basin washbasin sink plumbing' },
  bath: { art: IconBath, group: 'bathroom', keywords: 'bath bathtub shower' },
  'toilet-paper': { art: IconToiletPaper, group: 'bathroom', keywords: 'toilet wc loo restroom' },
  dental: { art: IconDental, group: 'bathroom', keywords: 'tooth toothbrush dentist dental' },
  // Cleaning & laundry
  cleaning: { art: IconSpray, group: 'cleaning', keywords: 'clean spray tidy' },
  vacuum: { art: IconVacuumCleaner, group: 'cleaning', keywords: 'vacuum cleaner hoover' },
  mop: { art: IconBucketDroplet, group: 'cleaning', keywords: 'mop bucket floor wipe' },
  laundry: { art: IconWashMachine, group: 'cleaning', keywords: 'washing machine wash clothes' },
  dryer: { art: IconWashTumbleDry, group: 'cleaning', keywords: 'tumble dryer drying' },
  ironing: { art: IconIroning, group: 'cleaning', keywords: 'iron clothes' },
  hanger: { art: IconHanger, group: 'cleaning', keywords: 'hanger clothes closet' },
  // Garden & plants
  garden: { art: IconSeedling, group: 'garden', keywords: 'gardening sprout grow' },
  plant: { art: IconPlant, group: 'garden', keywords: 'plant pot water plants' },
  flower: { art: IconFlower, group: 'garden', keywords: 'flower bloom' },
  tree: { art: IconTree, group: 'garden', keywords: 'trees hedge' },
  leaf: { art: IconLeaf, group: 'garden', keywords: 'leaf autumn rake' },
  'lawn-mower': { art: IconLawnMower, group: 'garden', keywords: 'lawn mower grass mow' },
  shovel: { art: IconShovel, group: 'garden', keywords: 'dig spade' },
  wheelbarrow: { art: IconGardenCart, group: 'garden', keywords: 'garden cart' },
  pool: { art: IconPool, group: 'garden', keywords: 'swimming pool' },
  // Vehicles
  car: { art: IconCar, group: 'vehicles', keywords: 'vehicle auto' },
  bike: { art: IconBike, group: 'vehicles', keywords: 'bicycle cycling' },
  motorbike: { art: IconMotorbike, group: 'vehicles', keywords: 'motorcycle vehicle' },
  scooter: { art: IconScooter, group: 'vehicles', keywords: 'kick scooter e-scooter' },
  bus: { art: IconBus, group: 'vehicles', keywords: 'public transport coach' },
  truck: { art: IconTruck, group: 'vehicles', keywords: 'van lorry vehicle' },
  camper: { art: IconCamper, group: 'vehicles', keywords: 'campervan motorhome caravan rv vehicle' },
  fuel: { art: IconGasStation, group: 'vehicles', keywords: 'fuel petrol diesel gas station' },
  tire: { art: IconWheel, group: 'vehicles', keywords: 'tire tyre wheel change' },
  engine: { art: IconEngine, group: 'vehicles', keywords: 'motor service oil' },
  parking: { art: IconParking, group: 'vehicles', keywords: 'park' },
  // Travel
  travel: { art: IconLuggage, group: 'travel', keywords: 'suitcase luggage packing trip vacation holiday' },
  plane: { art: IconPlane, group: 'travel', keywords: 'plane airport fly' },
  train: { art: IconTrain, group: 'travel', keywords: 'rail railway' },
  ship: { art: IconShip, group: 'travel', keywords: 'ferry cruise boat' },
  tent: { art: IconTent, group: 'travel', keywords: 'tent camp' },
  beach: { art: IconBeach, group: 'travel', keywords: 'holiday seaside' },
  mountain: { art: IconMountain, group: 'travel', keywords: 'hiking hike' },
  map: { art: IconMap, group: 'travel', keywords: 'route directions' },
  passport: { art: IconEPassport, group: 'travel', keywords: 'visa id' },
  ticket: { art: IconTicket, group: 'travel', keywords: 'tickets booking' },
  // Safety & first aid
  'fire-safety': { art: IconFireExtinguisher, group: 'safety', keywords: 'fire extinguisher' },
  'smoke-alarm': { art: IconAlarmSmoke, group: 'safety', keywords: 'smoke detector fire' },
  warning: { art: IconAlertTriangle, group: 'safety', keywords: 'danger caution hazard' },
  'first-aid': { art: IconFirstAidKit, group: 'safety', keywords: 'first aid kit emergency' },
  ambulance: { art: IconAmbulance, group: 'safety', keywords: 'ambulance emergency 112 911' },
  lifebuoy: { art: IconLifebuoy, group: 'safety', keywords: 'rescue help lifesaver' },
  helmet: { art: IconHelmet, group: 'safety', keywords: 'protection hard hat' },
  // Security
  security: { art: IconLock, group: 'security', keywords: 'lock locked' },
  shield: { art: IconShield, group: 'security', keywords: 'shield protect' },
  'home-lock': { art: IconHomeLock, group: 'security', keywords: 'home lock alarm system' },
  cctv: { art: IconDeviceCctv, group: 'security', keywords: 'cctv surveillance camera' },
  password: { art: IconPassword, group: 'security', keywords: 'pin code' },
  fingerprint: { art: IconFingerprint, group: 'security', keywords: 'biometric' },
  // Tools & maintenance
  tools: { art: IconTools, group: 'tools', keywords: 'tool repair fix' },
  wrench: { art: IconTool, group: 'tools', keywords: 'spanner repair fix' },
  hammer: { art: IconHammer, group: 'tools', keywords: 'nail diy' },
  drill: { art: IconHammerDrill, group: 'tools', keywords: 'drilling diy' },
  ruler: { art: IconRuler2, group: 'tools', keywords: 'ruler measure' },
  paint: { art: IconPaint, group: 'tools', keywords: 'paint roller decorate wall' },
  brush: { art: IconBrush, group: 'tools', keywords: 'paintbrush' },
  ladder: { art: IconLadder, group: 'tools', keywords: 'climb' },
  axe: { art: IconAxe, group: 'tools', keywords: 'firewood wood chop' },
  sewing: { art: IconNeedleThread, group: 'tools', keywords: 'needle thread mend' },
  maintenance: { art: IconHomeCog, group: 'tools', keywords: 'service inspection servicing' },
  settings: { art: IconSettings, group: 'tools', keywords: 'gear configure setup' },
  // Documents & money
  document: { art: IconFileText, group: 'documents', keywords: 'file paper' },
  folder: { art: IconFolder, group: 'documents', keywords: 'files' },
  signature: { art: IconSignature, group: 'documents', keywords: 'sign contract' },
  receipt: { art: IconReceipt, group: 'documents', keywords: 'invoice bill' },
  tax: { art: IconReceiptTax, group: 'documents', keywords: 'tax return' },
  certificate: { art: IconCertificate, group: 'documents', keywords: 'diploma award' },
  'id-card': { art: IconId, group: 'documents', keywords: 'identity card id' },
  printer: { art: IconPrinter, group: 'documents', keywords: 'print' },
  money: { art: IconCash, group: 'documents', keywords: 'cash banknote euro pay payment' },
  wallet: { art: IconWallet, group: 'documents', keywords: 'purse' },
  'credit-card': { art: IconCreditCard, group: 'documents', keywords: 'credit card debit bank' },
  // Shopping
  shopping: { art: IconShoppingCart, group: 'shopping', keywords: 'groceries supermarket cart' },
  'shopping-bag': { art: IconShoppingBag, group: 'shopping', keywords: 'bag store' },
  basket: { art: IconBasket, group: 'shopping', keywords: 'groceries' },
  gift: { art: IconGift, group: 'shopping', keywords: 'present birthday' },
  tag: { art: IconTag, group: 'shopping', keywords: 'price sale tag' },
  delivery: { art: IconPackage, group: 'shopping', keywords: 'parcel package' },
  // Food & drink
  food: { art: IconToolsKitchen2, group: 'food', keywords: 'meal eat dinner lunch cutlery' },
  coffee: { art: IconCoffee, group: 'food', keywords: 'tea cup' },
  drink: { art: IconGlassFull, group: 'food', keywords: 'drink glass water' },
  beer: { art: IconBeer, group: 'food', keywords: 'drinks' },
  pizza: { art: IconPizza, group: 'food', keywords: 'takeaway' },
  bread: { art: IconBread, group: 'food', keywords: 'bakery' },
  fruit: { art: IconApple, group: 'food', keywords: 'apple' },
  vegetables: { art: IconCarrot, group: 'food', keywords: 'carrot veg' },
  milk: { art: IconMilk, group: 'food', keywords: 'dairy' },
  egg: { art: IconEgg, group: 'food', keywords: 'egg breakfast' },
  // Animals
  pet: { art: IconPaw, group: 'animals', keywords: 'animal pets' },
  dog: { art: IconDog, group: 'animals', keywords: 'walk dogs' },
  cat: { art: IconCat, group: 'animals', keywords: 'cats' },
  fish: { art: IconFish, group: 'animals', keywords: 'aquarium' },
  horse: { art: IconHorse, group: 'animals', keywords: 'riding' },
  'pet-food': { art: IconDogBowl, group: 'animals', keywords: 'feed feeding bowl' },
  bug: { art: IconBug, group: 'animals', keywords: 'bug insect pest' },
  // Technology
  computer: { art: IconDeviceLaptop, group: 'tech', keywords: 'laptop pc' },
  desktop: { art: IconDeviceDesktop, group: 'tech', keywords: 'monitor pc screen' },
  tablet: { art: IconDeviceTablet, group: 'tech', keywords: 'ipad' },
  tv: { art: IconDeviceTv, group: 'tech', keywords: 'television' },
  headphones: { art: IconHeadphones, group: 'tech', keywords: 'audio' },
  router: { art: IconRouter, group: 'tech', keywords: 'modem network' },
  server: { art: IconServer, group: 'tech', keywords: 'servers' },
  database: { art: IconDatabase, group: 'tech', keywords: 'data' },
  cloud: { art: IconCloudUpload, group: 'tech', keywords: 'cloud upload sync' },
  backup: { art: IconDeviceFloppy, group: 'tech', keywords: 'save' },
  update: { art: IconRefresh, group: 'tech', keywords: 'refresh reload sync' },
  launch: { art: IconRocket, group: 'tech', keywords: 'release deploy start' },
  // Communication
  mail: { art: IconMail, group: 'communication', keywords: 'email letter' },
  mailbox: { art: IconMailbox, group: 'communication', keywords: 'post letterbox letters' },
  phone: { art: IconDeviceMobile, group: 'communication', keywords: 'smartphone mobile' },
  call: { art: IconPhone, group: 'communication', keywords: 'telephone landline' },
  message: { art: IconMessage, group: 'communication', keywords: 'chat sms text' },
  announcement: { art: IconSpeakerphone, group: 'communication', keywords: 'megaphone announce' },
  // People & work
  onboarding: { art: IconUserPlus, group: 'people', keywords: 'new hire join welcome start' },
  offboarding: { art: IconUserMinus, group: 'people', keywords: 'leave leaver exit' },
  team: { art: IconUsers, group: 'people', keywords: 'group people' },
  family: { art: IconFriends, group: 'people', keywords: 'friends family people' },
  work: { art: IconBriefcase, group: 'people', keywords: 'job office business' },
  school: { art: IconSchool, group: 'people', keywords: 'education study' },
  baby: { art: IconBabyBottle, group: 'people', keywords: 'infant bottle' },
  stroller: { art: IconBabyCarriage, group: 'people', keywords: 'pram buggy baby' },
  fitness: { art: IconRun, group: 'people', keywords: 'sport exercise running' },
  gym: { art: IconBarbell, group: 'people', keywords: 'weights training' },
  // Health
  health: { art: IconStethoscope, group: 'health', keywords: 'doctor medical checkup' },
  medication: { art: IconPill, group: 'health', keywords: 'medicine pills tablets' },
  vaccine: { art: IconVaccine, group: 'health', keywords: 'vaccine injection jab' },
  thermometer: { art: IconThermometer, group: 'health', keywords: 'fever temperature' },
  heart: { art: IconHeartbeat, group: 'health', keywords: 'pulse cardio blood pressure' },
  mask: { art: IconFaceMask, group: 'health', keywords: 'mask' },
  wheelchair: { art: IconWheelchair, group: 'health', keywords: 'wheelchair accessible' },
  hospital: { art: IconBuildingHospital, group: 'health', keywords: 'clinic' },
  // Weather
  weather: { art: IconUmbrella, group: 'weather', keywords: 'umbrella rain' },
  sun: { art: IconSun, group: 'weather', keywords: 'summer sunny' },
  rain: { art: IconCloudRain, group: 'weather', keywords: 'rainy' },
  storm: { art: IconCloudStorm, group: 'weather', keywords: 'thunder lightning' },
  wind: { art: IconWind, group: 'weather', keywords: 'windy' },
  snow: { art: IconCloudSnow, group: 'weather', keywords: 'snowfall winter' },
  night: { art: IconMoon, group: 'weather', keywords: 'moon evening' },
  // Storage
  box: { art: IconBox, group: 'storage', keywords: 'storage' },
  boxes: { art: IconBoxMultiple, group: 'storage', keywords: 'moving storage' },
  archive: { art: IconArchive, group: 'storage', keywords: 'store' },
  warehouse: { art: IconBuildingWarehouse, group: 'storage', keywords: 'warehouse storage' },
  // Waste & recycling
  trash: { art: IconTrash, group: 'waste', keywords: 'bin garbage rubbish waste' },
  recycling: { art: IconRecycle, group: 'waste', keywords: 'recycle waste bin' },
  compost: { art: IconLeaf2, group: 'waste', keywords: 'organic bio waste' },
  'paper-waste': { art: IconPaperBag, group: 'waste', keywords: 'paper cardboard bag' },
  // Miscellaneous
  camera: { art: IconCamera, group: 'misc', keywords: 'photo picture' },
  book: { art: IconBook, group: 'misc', keywords: 'manual reading' },
  music: { art: IconMusic, group: 'misc', keywords: 'song' },
  puzzle: { art: IconPuzzle, group: 'misc', keywords: 'puzzle game' },
  trophy: { art: IconTrophy, group: 'misc', keywords: 'win award' },
  love: { art: IconHeart, group: 'misc', keywords: 'heart favourite' },
  party: { art: IconBalloon, group: 'misc', keywords: 'birthday celebration' },
  christmas: { art: IconChristmasTree, group: 'misc', keywords: 'holiday xmas' },
  candle: { art: IconCandle, group: 'misc', keywords: 'candles' },
};

/** Picker categories in display order. */
export const ICON_GROUP_ORDER: readonly IconGroupKey[] = [
  'tasks', 'home', 'access', 'utilities', 'kitchen', 'bathroom', 'cleaning', 'garden', 'vehicles', 'travel', 'safety', 'security', 'tools',
  'documents', 'shopping', 'food', 'animals', 'tech', 'communication', 'people', 'health', 'sport', 'clothing', 'places', 'weather', 'storage',
  'waste', 'misc',
];

interface IconEntry {
  readonly art: IconArt;
  readonly group: IconGroupKey;
  /** English fallback label for generated entries; hand-written ones use messages. */
  readonly label: string | null;
  readonly aliases: string;
  readonly tags: string;
}

/** Every trusted key → artwork, category and search words (hand-written first, then generated). */
export const ICON_REGISTRY: Readonly<Record<VmnIconKey, IconEntry>> = {
  ...(Object.fromEntries(
    Object.entries(CURATED_ICONS).map(([key, entry]) => [
      key,
      { art: entry.art, group: entry.group, label: null, aliases: entry.keywords, tags: CURATED_TABLER_TAGS[key] ?? '' },
    ]),
  ) as Record<Exclude<VmnIconKey, GeneratedKey>, IconEntry>),
  ...GENERATED_ICONS,
};

/** Categories with their icons in registry order; every icon is in exactly one. */
export const ICON_GROUPS: readonly { readonly key: IconGroupKey; readonly name: MessageKey; readonly icons: readonly VmnIconKey[] }[] = ICON_GROUP_ORDER.map((key) => ({
  key,
  name: `iconGroup.${key}`,
  icons: (Object.keys(ICON_REGISTRY) as VmnIconKey[]).filter((icon) => ICON_REGISTRY[icon].group === key),
}));

export const ICON_COUNT = Object.keys(ICON_REGISTRY).length;

/**
 * Whether a value is a known icon key. Own properties only, so "constructor", "__proto__" or
 * "toString" from stored or offline data never resolve to something else.
 */
export function isIconKey(value: unknown): value is VmnIconKey {
  return typeof value === 'string' && Object.hasOwn(ICON_REGISTRY, value);
}

export const iconLabel = (icon: VmnIconKey): string => {
  const message = `icon.${icon}`;
  return hasMessage(message) ? t(message) : (ICON_REGISTRY[icon].label ?? icon);
};

const splitWords = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');

interface SearchWords {
  /** The label shown in the picker. */
  readonly label: readonly string[];
  /** Key and VMN aliases. */
  readonly strong: readonly string[];
  readonly group: readonly string[];
  /** Tabler's tags. */
  readonly tags: readonly string[];
}

let searchIndex: Map<VmnIconKey, SearchWords> | null = null;

function wordsOf(icon: VmnIconKey): SearchWords {
  searchIndex ??= new Map();
  let words = searchIndex.get(icon);
  if (words === undefined) {
    const entry = ICON_REGISTRY[icon];
    words = {
      label: splitWords(iconLabel(icon)),
      strong: splitWords(`${icon} ${entry.aliases}`),
      group: splitWords(t(`iconGroup.${entry.group}`)),
      tags: splitWords(entry.tags),
    };
    searchIndex.set(icon, words);
  }
  return words;
}

/**
 * How well one typed word fits an icon (0 = not at all): its label, key and VMN aliases count most,
 * then Tabler's tags, then the category name. Word starts count for names; for tags only from 4 letters
 * ("fan" must not find "fantasy").
 */
function scoreWord(needle: string, words: SearchWords): number {
  const exact = (list: readonly string[]) => list.includes(needle);
  const start = (list: readonly string[]) => list.some((word) => word.startsWith(needle));
  if (exact(words.label) || exact(words.strong)) return 10;
  if (start(words.label) || start(words.strong)) return 6;
  if (exact(words.tags)) return 4;
  if (exact(words.group)) return 3;
  if (needle.length >= 4 && start(words.tags)) return 2;
  if (start(words.group)) return 2;
  return 0;
}

const ORDER = new Map((Object.keys(ICON_REGISTRY) as VmnIconKey[]).map((icon, index) => [icon, index]));

/**
 * Icons matching a search, best first: every typed word must fit (see `scoreWord`); optionally within
 * one category. An empty query matches nothing (use `searchIcons` to browse).
 */
export function rankIcons(query: string, group: IconGroupKey | null = null): VmnIconKey[] {
  const needles = splitWords(query);
  if (needles.length === 0) return [];
  const scored: { icon: VmnIconKey; score: number }[] = [];
  for (const icon of Object.keys(ICON_REGISTRY) as VmnIconKey[]) {
    if (group !== null && ICON_REGISTRY[icon].group !== group) continue;
    const words = wordsOf(icon);
    let score = 0;
    for (const needle of needles) {
      const one = scoreWord(needle, words);
      if (one === 0) {
        score = 0;
        break;
      }
      score += one;
    }
    // Typing exactly an icon's name ("box") puts it before icons that only contain the word ("fuse box").
    if (score > 0 && words.label.join(' ') === needles.join(' ')) score += 5;
    if (score > 0) scored.push({ icon, score });
  }
  return scored.sort((a, b) => b.score - a.score || (ORDER.get(a.icon) ?? 0) - (ORDER.get(b.icon) ?? 0)).map((entry) => entry.icon);
}

/** Categories with their icons for browsing, optionally only one category; a query narrows them (like `rankIcons`). */
export function searchIcons(query: string, group: IconGroupKey | null = null): typeof ICON_GROUPS {
  const matching = splitWords(query).length === 0 ? null : new Set(rankIcons(query, group));
  return ICON_GROUPS.filter((entry) => group === null || entry.key === group)
    .map((entry) => ({ ...entry, icons: matching === null ? entry.icons : entry.icons.filter((icon) => matching.has(icon)) }))
    .filter((entry) => entry.icons.length > 0);
}

/** Shown for a value that is not (or no longer) a known key, e.g. data from a newer version. */
const FALLBACK: IconArt = IconCircleDashed;

/** Size and stroke shared by every icon so they sit evenly next to text. */
const ICON_SIZE = '1.15em';
const ICON_STROKE = 1.75;

/**
 * Renders a stored icon key. Only registry artwork can appear: an unknown value (anything a file,
 * old data or an attacker supplies) shows the neutral fallback and is never used to load or build
 * anything. `decorative` hides it from assistive technology when a visible label is next to it.
 */
export function AppIcon(props: { name: string; decorative?: boolean; size?: number | string; stroke?: number | string; className?: string }) {
  const known = isIconKey(props.name);
  const Art = known ? ICON_REGISTRY[props.name as VmnIconKey].art : FALLBACK;
  const label = known ? iconLabel(props.name as VmnIconKey) : t('icon.unknown');
  const art = <Art size={props.size ?? ICON_SIZE} stroke={props.stroke ?? ICON_STROKE} aria-hidden="true" focusable="false" />;
  const className = props.className === undefined ? 'app-icon' : `app-icon ${props.className}`;
  if (props.decorative === true) {
    return (
      <span className={className} aria-hidden="true">
        {art}
      </span>
    );
  }
  return (
    <span className={className} role="img" aria-label={label} title={label}>
      {art}
    </span>
  );
}
