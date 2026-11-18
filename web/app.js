"use strict";

const PACKAGES = {
  starter: { rate: 25000, unit: "day", en: "Starter Package", sw: "Kifurushi cha Kuanzia" },
  weekend: { rate: 50000, unit: "weekend", en: "Weekend Package", sw: "Kifurushi cha Wikendi" },
  night: { rate: 15000, unit: "night", en: "Night Package", sw: "Kifurushi cha Usiku" },
};

const ZONES = {
  goba: { fee: 6000, en: "Goba / Kimara / Ubungo", sw: "Goba / Kimara / Ubungo" },
  sinza: { fee: 8000, en: "Sinza / Mwenge / Makumbusho / Kijitonyama", sw: "Sinza / Mwenge / Makumbusho / Kijitonyama" },
  mbezi: { fee: 8000, en: "Mbezi Beach / Kawe / Tegeta", sw: "Mbezi Beach / Kawe / Tegeta" },
  kigamboni: { fee: 10000, en: "Kigamboni", sw: "Kigamboni" },
  magomeni: { fee: 10000, en: "Magomeni / Kariakoo / Kinondoni / Morocco", sw: "Magomeni / Kariakoo / Kinondoni / Morocco" },
  oyster: { fee: 10000, en: "Oyster Bay / Mikocheni / Masaki", sw: "Oyster Bay / Mikocheni / Masaki" },
  other: { fee: null, en: "Other area", sw: "Eneo lingine" },
};

const WHATSAPP_NUMBER = "255613138426";

const I18N = {
  en: {
    "nav.packages": "Packages", "nav.book": "Book", "nav.games": "Games",
    "nav.delivery": "Delivery", "nav.faq": "FAQ", "nav.cta": "Book now",
    "nav.account": "My account",
    "nav.admin": "Admin",
    "hero.badge": "PlayStation 5 rentals · Dar es Salaam",
    "hero.title": "Rent a PS5. At your door in 1–2 hours.",
    "hero.sub": "Day, weekend or overnight rentals anywhere in Dar es Salaam. Pay with M-Pesa or on delivery — no deposit, just a valid ID and an emergency contact.",
    "hero.cta1": "Choose a package", "hero.cta2": "How it works",
    "hero.stat1": "Delivery anywhere in Dar es Salaam", "hero.stat2": "Security deposit — ID check only", "hero.stat3": "Night package, per night",
    "packages.pill": "Rental plans",
    "packages.title": "Rental packages",
    "packages.sub": "Every package includes 1 PS5 console and 2 DualSense controllers, pre-installed and set up at your door. Weekend and Night rentals include up to 5 games of your choice; the Starter arrives with 5 popular titles pre-loaded.",
    "pkg.perDay": "/ day", "pkg.perDayShort": "/day", "pkg.perWeekend": "/ weekend", "pkg.perWeekendShort": "/weekend",
    "pkg.perNight": "/ night", "pkg.perNightShort": "/night", "pkg.popular": "Best value", "pkg.select": "Rent this",
    "pkg1.name": "Starter Package", "pkg1.desc": "Flexible day rentals with multi-day discounts.", "pkg1.f1": "1 PS5 console", "pkg1.f2": "2 DualSense controllers",
    "pkg1.f3": "5 popular games pre-installed", "pkg1.f4": "Multi-day discounts with free delivery",
    "pkg2.name": "Weekend Package", "pkg2.desc": "Friday to Sunday at a fixed price, delivered free.", "pkg2.f1": "1 PS5 console + 2 DualSense controllers", "pkg2.f2": "Up to 5 games of your choice",
    "pkg2.f3": "Free delivery and pickup", "pkg2.f4": "Ideal for family weekends",
    "pkg3.name": "Night Package", "pkg3.desc": "Overnight sessions, delivered at 8:00 PM.", "pkg3.f1": "1 PS5 console + 2 DualSense controllers", "pkg3.f2": "Up to 5 games of your choice",
    "pkg3.f3": "8:00 PM to 10:00 AM overnight", "pkg3.f4": "Perfect for late-night gaming sessions",
    "book.title": "Build your rental",
    "book.sub": "Pick your package, schedule and area — we confirm availability within 30 minutes.",
    "book.step1": "1 · Choose package", "book.step2": "2 · Duration & schedule", "book.step3": "3 · Delivery location",
    "book.step4": "4 · Your details", "book.step5": "5 · ID check & emergency contact", "book.step6": "6 · Payment method",
    "book.d1": "1 day", "book.d2": "2 days", "book.d3": "3 days", "book.d4": "4 days", "book.d5": "5+ days",
    "book.customDays": "Number of days", "book.customNights": "Number of nights",
    "book.weekendNote": "The Weekend Package covers Friday to Sunday at a fixed TZS 50,000, with free delivery and pickup.",
    "book.nightNote": "Each night runs from 8:00 PM to 10:00 AM the next morning, at TZS 15,000 per night.",
    "book.date": "Booking date", "book.time": "Delivery time",
    "book.pkgErr": "Please choose a package.",
    "book.scheduleErr": "Please choose a booking date and delivery time.",
    "book.zone": "Your area in Dar es Salaam",
    "zone.goba": "Goba / Kimara / Ubungo — TZS 6,000", "zone.sinza": "Sinza / Mwenge / Makumbusho / Kijitonyama — TZS 8,000",
    "zone.mbezi": "Mbezi Beach / Kawe / Tegeta — TZS 8,000", "zone.kigamboni": "Kigamboni — TZS 10,000",
    "zone.magomeni": "Magomeni / Kariakoo / Kinondoni / Morocco — TZS 10,000", "zone.oyster": "Oyster Bay / Mikocheni / Masaki — TZS 10,000",
    "zone.other": "Other area (not listed)",
    "book.zoneNote": "Your area is not listed — the delivery fee will be agreed with the rider when we confirm your booking.",
    "book.address": "Street / landmark", "book.addressPh": "e.g. Sinza, near Shabibi supermarket",
    "book.addressErr": "Please enter your street or landmark.",
    "book.name": "Full name", "book.namePh": "e.g. Amina Juma", "book.nameErr": "Please enter your name.",
    "book.phone": "Phone (M-Pesa & WhatsApp)", "book.phonePh": "07XX XXX XXX or +2557XXXXXXXX",
    "book.phoneErr": "Enter a valid Tanzanian number (e.g. 0712345678).",
    "book.idType": "ID type (KYC)", "id.nida": "NIDA ID", "id.licence": "Driver's licence", "id.passport": "Passport",
    "book.idNumber": "ID number", "book.idNumberPh": "e.g. 19900101-12345-67890-12", "book.idErr": "Enter your ID number.",
    "book.ecName": "Emergency contact name", "book.ecNamePh": "e.g. Juma Hassan", "book.ecNameErr": "Please enter an emergency contact name.",
    "book.ecPhone": "Emergency contact phone",
    "book.kycNote": "We verify your ID at delivery and return it with the console. No deposit is required.",
    "pay.mpesa": "M-Pesa after confirmation", "pay.mpesaSub": "We send the Lipa number once confirmed",
    "pay.cod": "Pay on delivery", "pay.codSub": "Cash or M-Pesa to the rider",
    "book.submit": "Confirm booking request",
    "book.sending": "Sending your booking…",
    "book.note": "No payment now — we confirm availability first, then you pay your way.",
    "sum.title": "Your rental", "sum.package": "Package", "sum.duration": "Duration", "sum.schedule": "Schedule",
    "sum.rental": "Rental cost", "sum.discount": "Discount", "sum.delivery": "Delivery (round trip)",
    "sum.total": "Total due", "sum.free": "Free", "sum.tbd": "To agree with rider",
    "sum.tbdNote": "Delivery fee for unlisted areas is agreed with the rider on confirmation and added to this total.",
    "conf.sentTitle": "Booking sent!",
    "conf.sentSub": "Your booking was sent to us automatically — we confirm within 30 minutes (8:00–22:00 EAT).",
    "conf.failedTitle": "We couldn't send your booking",
    "conf.failedSub": "Our booking service is temporarily unavailable. Send the same request on WhatsApp below, or try again — we confirm within 30 minutes.",
    "conf.refLabel": "Booking reference",
    "conf.retry": "Try sending again",
    "conf.stepsTitle": "What happens next",
    "conf.s1": "Tap the WhatsApp button below to send us your request — this is required so we can confirm your booking. We reply within 30 min (8:00–22:00 EAT).",
    "conf.s2mpesa": "You pay via M-Pesa: dial *150*00#, choose Lipa kwa M-Pesa, and use the business number we send you.",
    "conf.s2cod": "You pay on delivery — cash or M-Pesa directly to the rider when the console arrives.",
    "conf.s3": "We deliver and set up within 1–2 hours anywhere in Dar es Salaam, verify your ID, and pick up when your rental ends.",
    "conf.wa": "Send request on WhatsApp", "conf.waConfirm": "Message us on WhatsApp to confirm your booking", "conf.waRequired": "Required", "conf.edit": "Edit my booking",
    "games.title": "Games included",
    "games.sub": "Weekend and Night rentals include up to 5 games of your choice; the Starter Package arrives pre-loaded with 5 popular titles. Current library highlights — tell us your picks when booking.",
    "genre.shooter": "Shooter", "genre.basketball": "Basketball", "genre.football": "Football", "genre.action": "Action",
    "how.title": "How it works",
    "how.s1t": "Build your rental", "how.s1d": "Choose a package, schedule and your area on this page.",
    "how.s2t": "We confirm in 30 min", "how.s2d": "We call or WhatsApp you to lock in dates and availability.",
    "how.s3t": "Pay your way", "how.s3d": "M-Pesa after confirmation, or cash / M-Pesa to the rider on delivery. No deposit.",
    "how.s4t": "We deliver in 1–2 hours", "how.s4d": "Set up at your door anywhere in Dar es Salaam; we pick up when you're done.",
    "del.title": "Delivery areas & fees",
    "del.sub": "Dar es Salaam only — delivery and pickup within 1–2 hours. Fees cover the round trip; Starter rentals of 2+ days and the Weekend Package include free delivery.",
    "del.th1": "Area", "del.th2": "Fee",
    "del.goba": "Goba / Kimara / Ubungo", "del.sinza": "Sinza / Mwenge / Makumbusho / Kijitonyama",
    "del.mbezi": "Mbezi Beach / Kawe / Tegeta", "del.kigamboni": "Kigamboni",
    "del.magomeni": "Magomeni / Kariakoo / Kinondoni / Morocco", "del.oyster": "Oyster Bay / Mikocheni / Masaki",
    "del.other": "Other areas in Dar es Salaam", "del.otherFee": "Agreed with the rider",
    "faq.title": "Frequently asked questions",
    "faq.q1": "Do I need to pay a deposit?",
    "faq.a1": "No deposit at all. We verify your NIDA ID, driver's licence or passport at delivery, plus one emergency contact — that's our only security check.",
    "faq.q2": "Which areas do you deliver to?",
    "faq.a2": "All of Dar es Salaam, within 1–2 hours. Listed areas have fixed round-trip fees; if your area is not listed we agree the fee with the rider when confirming.",
    "faq.q3": "How does the Night Package work?",
    "faq.a3": "We deliver at 8:00 PM and collect at 10:00 AM the next morning — TZS 15,000 per night with the full Starter specs: console, 2 controllers and up to 5 games.",
    "faq.q4": "Can I pay on delivery?",
    "faq.a4": "Yes — cash or M-Pesa directly to the rider when the console arrives. You can also pay by M-Pesa after we confirm your booking.",
    "faq.q5": "What if the PS5 or a controller gets damaged?",
    "faq.a5": "Normal wear is fine. Real damage is charged at repair cost, and water damage or theft at replacement value — which is why we keep an ID and emergency contact on file.",
    "faq.q6": "Can I extend my rental?",
    "faq.a6": "Yes — message us on WhatsApp before your rental ends and pay the extra days. Multi-day discounts still apply to the extended period.",
    "footer.about": "Premium PS5 console rentals in Dar es Salaam, Tanzania — next-gen entertainment delivered to your door.",
    "footer.links": "Quick links", "footer.hub": "Find us",
    "footer.loc": "Mbezi Luis, Dar es Salaam, Tanzania",
    "footer.hours": "Pickup hours: 08:00 – 23:00",
    "footer.copy": "© 2026 Prime Games. All rights reserved. Dar es Salaam, Tanzania.",
    "dyn.days": (d) => `${d} day${d > 1 ? "s" : ""}`,
    "dyn.nights": (d) => `${d} night${d > 1 ? "s" : ""}`,
    "dyn.weekend": "Friday – Sunday",
    "dyn.summaryHead": "Prime Games booking request",
    "dyn.sPkg": "Package", "dyn.sDuration": "Duration", "dyn.sSchedule": "Schedule", "dyn.sRental": "Rental",
    "dyn.sDiscount": "Discount", "dyn.sDelivery": "Delivery", "dyn.sTotal": "Total",
    "dyn.sName": "Name", "dyn.sPhone": "Phone", "dyn.sAddress": "Address", "dyn.sId": "ID",
    "dyn.sEc": "Emergency contact", "dyn.sPay": "Payment",
    "dyn.payMpesa": "M-Pesa after confirmation", "dyn.payCod": "Pay on delivery",
    "dyn.free": "Free", "dyn.tbd": "To agree with rider",
    "dyn.waText": (s) => `Hello Prime Games! I'd like to rent a PS5:\n\n${s}\n\nPlease confirm availability.`,
    "doc.title": "Prime Games — PS5 Rentals in Dar es Salaam",
  },
  sw: {
    "nav.packages": "Vifurushi", "nav.book": "Weka Oda", "nav.games": "Michezo",
    "nav.delivery": "Usafirishaji", "nav.faq": "Maswali", "nav.cta": "Weka oda sasa",
    "nav.account": "Akaunti yangu",
    "nav.admin": "Msimamizi",
    "hero.badge": "Kukodisha PlayStation 5 · Dar es Salaam",
    "hero.title": "Kodisha PS5. Kwako mlangoni ndani ya saa 1–2.",
    "hero.sub": "Kodisha kwa siku, wikendi au usiku popote Dar es Salaam. Lipa kwa M-Pesa au unapopokea — bila amana, kitambulisho halali na mwasiliani wa dharura pekee.",
    "hero.cta1": "Chagua kifurushi", "hero.cta2": "Jinsi inavyofanya kazi",
    "hero.stat1": "Usafirishaji popote Dar es Salaam", "hero.stat2": "Amana ya ulinzi — kitambulisho pekee", "hero.stat3": "Kifurushi cha Usiku, kwa usiku",
    "packages.pill": "Vifurushi vya kodisha",
    "packages.title": "Vifurushi vya kukodisha",
    "packages.sub": "Kila kifurushi kinajumuisha konsoli 1 ya PS5 na vidhibiti 2 vya DualSense, vikiwa vimewekwa tayari mlango wako. Wikendi na Usiku vinajumuisha michezo hadi 5 unayochagua; Starter inakuja na michezo 5 maarufu ikiwa imewekwa tayari.",
    "pkg.perDay": "/ siku", "pkg.perDayShort": "/siku", "pkg.perWeekend": "/ wikendi", "pkg.perWeekendShort": "/wikendi",
    "pkg.perNight": "/ usiku", "pkg.perNightShort": "/usiku", "pkg.popular": "Thamani bora", "pkg.select": "Kodisha hiki",
    "pkg1.name": "Kifurushi cha Kuanzia", "pkg1.desc": "Kodisha kwa siku na mapunguzo ya siku nyingi.", "pkg1.f1": "Konsoli 1 ya PS5", "pkg1.f2": "Vidhibiti 2 vya DualSense",
    "pkg1.f3": "Michezo 5 maarufu ikiwa imewekwa tayari", "pkg1.f4": "Mapunguzo ya siku nyingi na usafirishaji bure",
    "pkg2.name": "Kifurushi cha Wikendi", "pkg2.desc": "Ijumaa hadi Jumapili kwa bei fixed, usafirishaji bure.", "pkg2.f1": "Konsoli 1 ya PS5 + vidhibiti 2 vya DualSense", "pkg2.f2": "Michezo hadi 5 unayochagua",
    "pkg2.f3": "Usafirishaji na uchukuzi bure", "pkg2.f4": "Kamili kwa wikendi za familia",
    "pkg3.name": "Kifurushi cha Usiku", "pkg3.desc": "Vipindi vya usiku, tunapeleka 8:00 PM.", "pkg3.f1": "Konsoli 1 ya PS5 + vidhibiti 2 vya DualSense", "pkg3.f2": "Michezo hadi 5 unayochagua",
    "pkg3.f3": "Usiku 8:00 PM hadi 10:00 AM", "pkg3.f4": "Kamili kwa vipindi vya usiku",
    "book.title": "Tengeneza oda yako",
    "book.sub": "Chagua kifurushi, ratiba na eneo — tunathibitisha upatikanaji ndani ya dakika 30.",
    "book.step1": "1 · Chagua kifurushi", "book.step2": "2 · Muda na ratiba", "book.step3": "3 · Eneo la usafirishaji",
    "book.step4": "4 · Taarifa zako", "book.step5": "5 · Kitambulisho na mwasiliani wa dharura", "book.step6": "6 · Njia ya malipo",
    "book.d1": "Siku 1", "book.d2": "Siku 2", "book.d3": "Siku 3", "book.d4": "Siku 4", "book.d5": "Siku 5+",
    "book.customDays": "Idadi ya siku", "book.customNights": "Idadi ya usiku",
    "book.weekendNote": "Kifurushi cha Wikendi kinachukua Ijumaa hadi Jumapili kwa bei fixed ya TZS 50,000, pamoja na usafirishaji na uchukuzi bure.",
    "book.nightNote": "Kila usiku huanza 8:00 PM na kuishia 10:00 AM asubuhi, kwa TZS 15,000 kwa usiku.",
    "book.date": "Tarehe ya oda", "book.time": "Saa ya kupelekwa",
    "book.pkgErr": "Tafadhali chagua kifurushi.",
    "book.scheduleErr": "Tafadhali chagua tarehe ya oda na saa ya kupelekwa.",
    "book.zone": "Eneo lako Dar es Salaam",
    "zone.goba": "Goba / Kimara / Ubungo — TZS 6,000", "zone.sinza": "Sinza / Mwenge / Makumbusho / Kijitonyama — TZS 8,000",
    "zone.mbezi": "Mbezi Beach / Kawe / Tegeta — TZS 8,000", "zone.kigamboni": "Kigamboni — TZS 10,000",
    "zone.magomeni": "Magomeni / Kariakoo / Kinondoni / Morocco — TZS 10,000", "zone.oyster": "Oyster Bay / Mikocheni / Masaki — TZS 10,000",
    "zone.other": "Eneo lingine (halijaorodheshwa)",
    "book.zoneNote": "Eneo lako halijaorodheshwa — ada ya usafirishaji itakubaliwa na rider tutapothibitisha oda yako.",
    "book.address": "Mtaa / alama ya kumbukumbu", "book.addressPh": "mf. Sinza, karibu na supamaket ya Shabibi",
    "book.addressErr": "Tafadhali weka mtaa au alama yako.",
    "book.name": "Jina kamili", "book.namePh": "mf. Amina Juma", "book.nameErr": "Tafadhali weka jina lako.",
    "book.phone": "Simu (M-Pesa na WhatsApp)", "book.phonePh": "07XX XXX XXX au +2557XXXXXXXX",
    "book.phoneErr": "Weka namba sahihi ya Tanzania (mf. 0712345678).",
    "book.idType": "Aina ya kitambulisho (KYC)", "id.nida": "Kitambulisho cha NIDA", "id.licence": "Leseni ya udereva", "id.passport": "Paspoti",
    "book.idNumber": "Namba ya kitambulisho", "book.idNumberPh": "mf. 19900101-12345-67890-12", "book.idErr": "Weka namba ya kitambulisho chako.",
    "book.ecName": "Jina la mwasiliani wa dharura", "book.ecNamePh": "mf. Juma Hassan", "book.ecNameErr": "Tafadhali weka jina la mwasiliani wa dharura.",
    "book.ecPhone": "Simu ya mwasiliani wa dharura",
    "book.kycNote": "Tunakagua kitambulisho chako wakati wa kupeleka na kurudisha pamoja na konsoli. Hakuna amana inayohitajika.",
    "pay.mpesa": "M-Pesa baada ya kuthibitisha", "pay.mpesaSub": "Tutakutumia namba ya Lipa tukithibitisha",
    "pay.cod": "Lipa unapopokea", "pay.codSub": "Pesa taslimu au M-Pesa kwa rider",
    "book.submit": "Thibitisha ombi la oda",
    "book.sending": "Tunatuma oda yako…",
    "book.note": "Hakuna malipo sasa — tunathibitisha upatikanaji kwanza, kisha unalipa kwa njia yako.",
    "sum.title": "Oda yako", "sum.package": "Kifurushi", "sum.duration": "Muda", "sum.schedule": "Ratiba",
    "sum.rental": "Gharama ya kukodisha", "sum.discount": "Punguzo", "sum.delivery": "Usafirishaji (kwenda na kurudi)",
    "sum.total": "Jumla inayolipwa", "sum.free": "Bure", "sum.tbd": "Kukubaliana na rider",
    "sum.tbdNote": "Ada ya usafirishaji kwa maeneo yasiyoorodheshwa itakubaliwa na rider wakati wa kuthibitisha na kuongezwa kwenye jumla hii.",
    "conf.sentTitle": "Oda imetumwa!",
    "conf.sentSub": "Oda yako imetumwa kwetu moja kwa moja — tunathibitisha ndani ya dakika 30 (8:00–22:00 EAT).",
    "conf.failedTitle": "Hatukuweza kutuma oda yako",
    "conf.failedSub": "Huduma yetu ya oda haipatikani kwa sasa. Tuma ombi lilelile kwa WhatsApp hapa chini, au jaribu tena — tunathibitisha ndani ya dakika 30.",
    "conf.refLabel": "Namba ya oda",
    "conf.retry": "Jaribu kutuma tena",
    "conf.stepsTitle": "Kinachofuata",
    "conf.s1": "Bonyeza kitufe cha WhatsApp hapa chini kututumia ombi lako — ni lazima ili tupate kuthibitisha oda yako. Tunajibu ndani ya dakika 30 (8:00–22:00 EAT).",
    "conf.s2mpesa": "Unalipa kwa M-Pesa: piga *150*00#, chagua Lipa kwa M-Pesa, na utumie namba ya biashara tutakayokutumia.",
    "conf.s2cod": "Unalipa unapopokea — pesa taslimu au M-Pesa moja kwa moja kwa rider konsoli kikifika.",
    "conf.s3": "Tunapeleka na kuweka ndani ya saa 1–2 popote Dar es Salaam, kukagua kitambulisho chako, na kuchukua ukimaliza.",
    "conf.wa": "Tuma ombi kwa WhatsApp", "conf.waConfirm": "Tutumie WhatsApp kuthibitisha oda yako", "conf.waRequired": "Lazima", "conf.edit": "Hariri oda yangu",
    "games.title": "Michezo iliyojumuishwa",
    "games.sub": "Kifurushi cha Wikendi na Usiku vinajumuisha michezo hadi 5 unayochagua; Kifurushi cha Kuanzia kinakuja na michezo 5 maarufu. Hii hapa michache ya sasa — tuambie uchaguzi wako unapoweka oda.",
    "genre.shooter": "Bunduki", "genre.basketball": "Mpira wa kikapu", "genre.football": "Mpira", "genre.action": "Vitendo",
    "how.title": "Jinsi inavyofanya kazi",
    "how.s1t": "Tengeneza oda yako", "how.s1d": "Chagua kifurushi, ratiba na eneo lako kwenye ukurasa huu.",
    "how.s2t": "Tunathibitisha dakika 30", "how.s2d": "Tunakupigia au kukutumia WhatsApp kuthibitisha tarehe na upatikanaji.",
    "how.s3t": "Lipa kwa njia yako", "how.s3d": "M-Pesa baada ya kuthibitisha, au pesa taslimu / M-Pesa kwa rider unapopokea. Bila amana.",
    "how.s4t": "Tunapeleka ndani ya saa 1–2", "how.s4d": "Tunaweka kila kitu mlango wako popote Dar es Salaam; tunachukua ukimaliza.",
    "del.title": "Maeneo ya usafirishaji na ada",
    "del.sub": "Dar es Salaam pekee — usafirishaji na uchukuzi ndani ya saa 1–2. Ada inajumuisha kwenda na kurudi; oda za Starter za siku 2+ na Kifurushi cha Wikendi vina usafirishaji bure.",
    "del.th1": "Eneo", "del.th2": "Ada",
    "del.goba": "Goba / Kimara / Ubungo", "del.sinza": "Sinza / Mwenge / Makumbusho / Kijitonyama",
    "del.mbezi": "Mbezi Beach / Kawe / Tegeta", "del.kigamboni": "Kigamboni",
    "del.magomeni": "Magomeni / Kariakoo / Kinondoni / Morocco", "del.oyster": "Oyster Bay / Mikocheni / Masaki",
    "del.other": "Maeneo mengine ya Dar es Salaam", "del.otherFee": "Kukubaliana na rider",
    "faq.title": "Maswali yanayoulizwa mara kwa mara",
    "faq.q1": "Nahitaji kulipa amana?",
    "faq.a1": "Hakuna amana kabisa. Tunakagua kitambulisho chako cha NIDA, leseni ya udereva au paspoti wakati wa kupeleka, pamoja na mwasiliani mmoja wa dharura — huo ndio ukaguzi wetu pekee.",
    "faq.q2": "Mnapeleka maeneo gani?",
    "faq.a2": "Dar es Salaam nzima, ndani ya saa 1–2. Maeneo yaliyoorodheshwa yana ada fixed za kwenda na kurudi; eneo lako likikosekana tunakubaliana ada na rider tukithibitisha.",
    "faq.q3": "Kifurushi cha Usiku kinafanya kazi vipi?",
    "faq.a3": "Tunapeleka 8:00 PM na kuchukua 10:00 AM asubuhi — TZS 15,000 kwa usiku, pamoja na vifaa vyote vya Starter: konsoli, vidhibiti 2 na michezo hadi 5.",
    "faq.q4": "Naweza kulipa unapopokea?",
    "faq.a4": "Ndiyo — pesa taslimu au M-Pesa moja kwa moja kwa rider konsoli kikifika. Pia unaweza kulipa kwa M-Pesa baada ya kuthibitisha oda.",
    "faq.q5": "Itakuwaje PS5 au kidhibiti kikiharibika?",
    "faq.a5": "Matumizi ya kawaida si tatizo. Uharibifu halisi hulipwa kwa gharama ya kurekebisha, na maji au wizi hulipwa kwa thamani ya kubadilisha — ndiyo maana tunahifadhi kitambulisho na mwasiliani wa dharura.",
    "faq.q6": "Naweza kuongeza muda wa kukodisha?",
    "faq.a6": "Ndiyo — tutumie WhatsApp kabla muda haujaisha na ulipe siku za ziada. Mapunguzo ya siku nyingi yanaendelea kutumika.",
    "footer.about": "Kodisha konsoli za PS5 Dar es Salaam, Tanzania — burudani ya kizazi kipya mlango wako.",
    "footer.links": "Viungo vya haraka", "footer.hub": "Tutafute",
    "footer.loc": "Mbezi Luis, Dar es Salaam, Tanzania",
    "footer.hours": "Saa za kuchukua: 08:00 – 23:00",
    "footer.copy": "© 2026 Prime Games. Haki zote zimehifadhiwa. Dar es Salaam, Tanzania.",
    "dyn.days": (d) => `siku ${d}`,
    "dyn.nights": (d) => `usiku ${d}`,
    "dyn.weekend": "Ijumaa – Jumapili",
    "dyn.summaryHead": "Ombi la oda Prime Games",
    "dyn.sPkg": "Kifurushi", "dyn.sDuration": "Muda", "dyn.sSchedule": "Ratiba", "dyn.sRental": "Kukodisha",
    "dyn.sDiscount": "Punguzo", "dyn.sDelivery": "Usafirishaji", "dyn.sTotal": "Jumla",
    "dyn.sName": "Jina", "dyn.sPhone": "Simu", "dyn.sAddress": "Anwani", "dyn.sId": "Kitambulisho",
    "dyn.sEc": "Mwasiliani wa dharura", "dyn.sPay": "Malipo",
    "dyn.payMpesa": "M-Pesa baada ya kuthibitisha", "dyn.payCod": "Lipa unapopokea",
    "dyn.free": "Bure", "dyn.tbd": "Kukubaliana na rider",
    "dyn.waText": (s) => `Habari Prime Games! Ningependa kukodisha PS5:\n\n${s}\n\nTafadhali thibitisheni upatikanaji.`,
    "doc.title": "Prime Games — Kodisha PS5 Dar es Salaam",
  },
};

let lang = localStorage.getItem("primegames-lang") === "sw" ? "sw" : "en";

const $ = (sel) => document.querySelector(sel);
const t = (key) => I18N[lang][key] ?? I18N.en[key] ?? key;

const fmtTZS = (n) => `TZS ${new Intl.NumberFormat("en-US").format(Math.round(n))}`;

function starterDiscount(days) {
  if (days >= 5) return 10000;
  if (days === 4) return 7000;
  if (days === 3) return 5000;
  return 0;
}

function currentBooking() {
  const checkedPkg = document.querySelector('input[name="pkg"]:checked');
  if (!checkedPkg) return null;
  const pkgKey = checkedPkg.value;
  const pkg = PACKAGES[pkgKey];
  const days = Math.min(30, Math.max(1, parseInt($("#daysInput").value, 10) || 1));
  const zoneKey = $("#zoneSelect").value;
  const zone = ZONES[zoneKey];

  let base, discount = 0, freeDelivery = false, durationText;
  if (pkgKey === "starter") {
    base = pkg.rate * days;
    discount = starterDiscount(days);
    freeDelivery = days >= 2;
    durationText = t("dyn.days")(days);
  } else if (pkgKey === "weekend") {
    base = pkg.rate;
    freeDelivery = true;
    durationText = t("dyn.weekend");
  } else {
    base = pkg.rate * days;
    durationText = t("dyn.nights")(days);
  }

  const rental = base - discount;
  const delivery = freeDelivery ? 0 : zone.fee; // null = to be agreed with rider
  const total = rental + (delivery ?? 0);
  return { pkgKey, pkg, days, zoneKey, zone, base, discount, rental, delivery, freeDelivery, total, durationText };
}

function scheduleText() {
  const date = $("#dateInput").value;
  const time = $("#timeInput").value;
  if (!date && !time) return "—";
  const parts = [];
  if (date) parts.push(new Date(`${date}T00:00:00`).toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-TZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" }));
  if (time) parts.push(time);
  return parts.join(" · ");
}

function renderSummary() {
  const b = currentBooking();
  if (!b) {
    ["#sumPkg", "#sumDays", "#sumRental", "#sumDelivery", "#sumTotal"].forEach((id) => { $(id).textContent = "—"; });
    $("#sumSchedule").textContent = scheduleText();
    $("#sumDiscountRow").hidden = true;
    $("#sumNote").hidden = true;
    $("#zoneNote").hidden = true;
    return;
  }
  $("#sumPkg").textContent = b.pkg[lang];
  $("#sumDays").textContent = b.durationText;
  $("#sumSchedule").textContent = scheduleText();
  $("#sumRental").textContent = fmtTZS(b.base);
  $("#sumDiscountRow").hidden = b.discount === 0;
  $("#sumDiscount").textContent = b.discount ? `− ${fmtTZS(b.discount)}` : "—";
  $("#sumDelivery").textContent = b.freeDelivery ? t("sum.free") : (b.delivery === null ? t("sum.tbd") : fmtTZS(b.delivery));
  $("#sumTotal").textContent = b.delivery === null ? `${fmtTZS(b.total)} + ${t("sum.tbd").toLowerCase()}` : fmtTZS(b.total);
  $("#sumNote").hidden = b.delivery !== null;
  $("#zoneNote").hidden = !(b.zoneKey === "other" && b.delivery === null);
}

function applyPackageUi() {
  const checkedPkg = document.querySelector('input[name="pkg"]:checked');
  const pkgKey = checkedPkg ? checkedPkg.value : null;
  $("#durationBlock").hidden = pkgKey === "weekend";
  $("#weekendNote").hidden = pkgKey !== "weekend";
  $("#nightNote").hidden = pkgKey !== "night";
  $("#daysLabel").textContent = pkgKey === "night" ? t("book.customNights") : t("book.customDays");
  renderSummary();
}

function applyLanguage() {
  document.documentElement.lang = lang === "sw" ? "sw" : "en";
  document.title = t("doc.title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = t(el.dataset.i18n);
    if (typeof v === "string") el.textContent = v;
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("#langToggle .lang-opt").forEach((opt) => {
    opt.classList.toggle("active", opt.dataset.lang === lang);
  });
  $("#langToggle").setAttribute("aria-label", lang === "sw" ? "Badili hadi Kiingereza" : "Switch to Swahili");
  applyPackageUi();
  if (!$("#confirmPanel").hidden && lastBooking) renderConfirmation(lastBooking);
}

function normalizePhone(raw) {
  const digits = raw.replace(/[\s\-()]/g, "");
  const m = digits.match(/^(\+?255|0)([67]\d{8})$/);
  return m ? "255" + m[2] : null;
}

let lastBooking = null;

function buildSummaryText(b) {
  const idLabel = { nida: t("id.nida"), licence: t("id.licence"), passport: t("id.passport") }[b.idType];
  const lines = [
    [t("dyn.sPkg"), b.pkg[lang]],
    [t("dyn.sDuration"), b.durationText],
    [t("dyn.sSchedule"), b.schedule],
    [t("dyn.sRental"), fmtTZS(b.base)],
  ];
  if (b.discount) lines.push([t("dyn.sDiscount"), `− ${fmtTZS(b.discount)}`]);
  lines.push([t("dyn.sDelivery"), b.freeDelivery ? t("dyn.free") : (b.delivery === null ? `${t("dyn.tbd")} (${b.zone[lang]})` : `${b.zone[lang]} · ${fmtTZS(b.delivery)}`)]);
  lines.push([t("dyn.sTotal"), b.delivery === null ? `${fmtTZS(b.total)} + ${t("dyn.tbd").toLowerCase()}` : fmtTZS(b.total)]);
  lines.push(
    [t("dyn.sName"), b.name],
    [t("dyn.sPhone"), b.phoneDisplay],
    [t("dyn.sAddress"), b.address],
    [t("dyn.sId"), `${idLabel} · ${b.idNumber}`],
    [t("dyn.sEc"), `${b.ecName} · ${b.ecPhoneDisplay}`],
    [t("dyn.sPay"), b.pay === "cod" ? t("dyn.payCod") : t("dyn.payMpesa")],
  );
  return lines.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function renderConfirmation(b) {
  const text = buildSummaryText(b);
  $("#confirmSummary").textContent = `${t("dyn.summaryHead")}\n${"─".repeat(34)}\n${text}`;
  $("#confPayMpesa").hidden = b.pay !== "mpesa";
  $("#confPayCod").hidden = b.pay !== "cod";
  $("#whatsappLink").href = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(t("dyn.waText")(text))}`;
  $("#confTitle").textContent = b.sent ? t("conf.sentTitle") : t("conf.failedTitle");
  $("#confSub").textContent = b.sent ? t("conf.sentSub") : t("conf.failedSub");
  const check = $("#confCheck");
  check.textContent = b.sent ? "✓" : "!";
  check.classList.toggle("is-error", !b.sent);
  $("#confRefRow").hidden = !b.sent;
  if (b.sent) {
    $("#confRefLabel").textContent = `${t("conf.refLabel")}:`;
    $("#confRef").textContent = b.ref;
  }
  $("#whatsappLink").textContent = b.sent ? t("conf.waConfirm") : t("conf.wa");
  $("#confRetry").hidden = b.sent !== false;
}

let lastPayload = null;

async function sendBooking(payload) {
  const btn = $("#bookingForm button[type='submit']");
  btn.disabled = true;
  btn.textContent = t("book.sending");
  let sent = false;
  let result = null;
  try {
    const res = await fetch(`${window.PG_API_BASE || "/functions/v1/app"}?action=create_booking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok === true && data.booking && typeof data.booking.ref === "string") {
      sent = true;
      result = data.booking;
    }
  } catch {
    // Offline or service unavailable — fall back to the WhatsApp flow below.
  }
  btn.disabled = false;
  btn.textContent = t("book.submit");
  return { sent, result };
}

function initHeroSlideshow() {
  const slides = Array.from(document.querySelectorAll(".hero-slide"));
  const dotsWrap = $("#heroDots");
  if (slides.length < 2 || !dotsWrap) return;
  let idx = 0;
  let timer = null;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dots = slides.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "hero-dot" + (i === 0 ? " is-active" : "");
    dot.setAttribute("aria-label", `Slide ${i + 1}`);
    dot.addEventListener("click", () => { show(i); restart(); });
    dotsWrap.appendChild(dot);
    return dot;
  });
  function show(i) {
    idx = (i + slides.length) % slides.length;
    slides.forEach((s, j) => s.classList.toggle("is-active", j === idx));
    dots.forEach((d, j) => d.classList.toggle("is-active", j === idx));
  }
  function stop() { clearInterval(timer); timer = null; }
  function start() {
    if (timer || reduceMotion.matches || document.hidden) return;
    timer = setInterval(() => show(idx + 1), 6500);
  }
  function restart() { stop(); start(); }
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
}

document.addEventListener("DOMContentLoaded", () => {
  const today = new Date().toISOString().slice(0, 10);
  $("#dateInput").min = today;
  $("#dateInput").value = today;
  initHeroSlideshow();

  $("#langToggle").addEventListener("click", () => {
    lang = lang === "en" ? "sw" : "en";
    localStorage.setItem("primegames-lang", lang);
    applyLanguage();
  });

  const chips = document.querySelectorAll(".chip");
  const daysInput = $("#daysInput");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      daysInput.value = chip.dataset.days;
      chips.forEach((c) => c.classList.toggle("is-active", c === chip));
      renderSummary();
    });
  });
  daysInput.addEventListener("input", () => {
    chips.forEach((c) => c.classList.toggle("is-active", c.dataset.days === daysInput.value));
    renderSummary();
  });

  document.querySelectorAll('input[name="pkg"]').forEach((r) => r.addEventListener("change", () => {
    $("#pkgError").hidden = true;
    applyPackageUi();
  }));
  document.querySelectorAll(".pkg-select").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector(`input[name="pkg"][value="${btn.dataset.select}"]`).checked = true;
      $("#pkgError").hidden = true;
      applyPackageUi();
      $("#book").scrollIntoView({ behavior: "smooth" });
    });
  });
  $("#zoneSelect").addEventListener("change", renderSummary);
  $("#dateInput").addEventListener("change", renderSummary);
  $("#timeInput").addEventListener("change", renderSummary);

  $("#bookingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    let ok = true;
    const fail = (inputId, errId, bad) => {
      $(errId).hidden = !bad;
      if (bad) { ok = false; $(inputId).focus({ preventScroll: true }); }
      return bad;
    };

    const pkgChecked = document.querySelector('input[name="pkg"]:checked');
    $("#pkgError").hidden = !!pkgChecked;
    if (!pkgChecked) ok = false;

    const name = $("#nameInput").value.trim();
    fail("#nameInput", "#nameError", name.length < 2);

    const phoneRaw = $("#phoneInput").value.trim();
    const phone = normalizePhone(phoneRaw);
    fail("#phoneInput", "#phoneError", !phone);

    const date = $("#dateInput").value;
    const time = $("#timeInput").value;
    $("#scheduleError").hidden = !!(date && time);
    if (!date || !time) ok = false;

    const address = $("#addressInput").value.trim();
    fail("#addressInput", "#addressError", address.length < 3);

    const idNumber = $("#idNumberInput").value.trim();
    fail("#idNumberInput", "#idError", idNumber.length < 4);

    const ecName = $("#ecNameInput").value.trim();
    fail("#ecNameInput", "#ecNameError", ecName.length < 2);

    const ecPhoneRaw = $("#ecPhoneInput").value.trim();
    const ecPhone = normalizePhone(ecPhoneRaw);
    fail("#ecPhoneInput", "#ecPhoneError", !ecPhone);

    if (!ok) return;

    const base = currentBooking();
    const idType = $("#idTypeSelect").value;
    const pay = document.querySelector('input[name="pay"]:checked').value;
    lastPayload = {
      package: base.pkgKey,
      days: base.pkgKey === "weekend" ? 1 : base.days,
      zone: base.zoneKey,
      start_date: date,
      start_time: time,
      name,
      phone,
      address,
      id_type: idType,
      id_number: idNumber,
      ec_name: ecName,
      ec_phone: ecPhone,
      payment_method: pay,
    };

    const { sent, result } = await sendBooking(lastPayload);
    lastBooking = {
      ...base,
      schedule: scheduleText(),
      name, phoneDisplay: phoneRaw, address,
      idType, idNumber,
      ecName, ecPhoneDisplay: ecPhoneRaw,
      pay,
      sent, ref: result ? result.ref : null,
    };
    renderConfirmation(lastBooking);
    const panel = $("#confirmPanel");
    panel.hidden = false;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#confRetry").addEventListener("click", async () => {
    if (!lastPayload) return;
    const { sent, result } = await sendBooking(lastPayload);
    lastBooking = { ...lastBooking, sent, ref: result ? result.ref : lastBooking.ref };
    renderConfirmation(lastBooking);
  });

  $("#backToForm").addEventListener("click", () => {
    $("#confirmPanel").hidden = true;
    $("#bookingForm").scrollIntoView({ behavior: "smooth" });
  });

  applyLanguage();
});
