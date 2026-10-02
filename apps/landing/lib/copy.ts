import type { Locale } from "./i18n";

/**
 * Every word on the landing page, in both languages.
 *
 * Centralised rather than inlined so that `i18next/no-literal-string` (see
 * eslint.config.mjs) can make an untranslated sentence a lint error. The
 * shape is a plain typed object, not an i18next runtime: the page is fully
 * static with one dictionary chosen per route, so there is nothing to
 * resolve at request time and no reason to ship a translation library to
 * the browser.
 *
 * The product claims below are deliberately limited to what GymOS actually
 * ships today -- QR check-in, members and subscriptions, payments, classes,
 * workout plans, coaches, progress tracking, staff roles, and the member
 * app. Nothing here describes a feature that does not exist.
 */

export interface Feature {
  title: string;
  body: string;
}

export interface Testimonial {
  quote: string;
  name: string;
  gym: string;
}

export interface Copy {
  meta: {
    title: string;
    description: string;
  };
  nav: {
    features: string;
    how: string;
    app: string;
    contact: string;
    login: string;
    switchTo: string;
    switchLabel: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    primaryCtaEmail: string;
    secondaryCta: string;
  };
  earlyAccess: {
    badge: string;
    title: string;
    body: string;
  };
  pillars: {
    title: string;
    subtitle: string;
    items: Feature[];
  };
  features: {
    title: string;
    subtitle: string;
    items: Feature[];
  };
  how: {
    title: string;
    subtitle: string;
    steps: Feature[];
  };
  app: {
    title: string;
    body: string;
    appStore: string;
    playStore: string;
    note: string;
  };
  testimonials: {
    title: string;
    subtitle: string;
    items: Testimonial[];
  };
  proof: {
    title: string;
    subtitle: string;
    items: Feature[];
  };
  cta: {
    title: string;
    body: string;
    whatsapp: string;
    email: string;
    prefilledMessage: string;
  };
  footer: {
    tagline: string;
    product: string;
    ownerLogin: string;
    memberApp: string;
    company: string;
    contact: string;
    privacy: string;
    facebook: string;
    poweredBy: string;
    rights: string;
  };
}

const en: Copy = {
  meta: {
    title: "GymOS — Gym management software for gym owners",
    description:
      "QR-code check-in, membership and payment tracking, classes, workout plans, and a member app on Android and iPhone. Built for gym owners.",
  },
  nav: {
    features: "Features",
    how: "How it works",
    app: "Member app",
    contact: "Talk to us",
    login: "Owner login",
    switchTo: "Français",
    switchLabel: "Switch language",
  },
  hero: {
    eyebrow: "Gym management software, built for gym owners",
    title: "Run a smarter gym. Check members in at the speed of a scan.",
    subtitle:
      "GymOS replaces the notebook, the spreadsheet and the WhatsApp group with one system: members scan a QR code to check in, subscriptions renew on time, and you can see what is actually happening in your gym from your phone.",
    primaryCta: "Talk to us on WhatsApp",
    primaryCtaEmail: "Email us",
    secondaryCta: "See what it does",
  },
  earlyAccess: {
    badge: "Now onboarding our first gyms",
    title: "We are setting up our founding gyms right now.",
    body:
      "GymOS is live and in use, and we are deliberately taking on a small number of gyms first so that each one gets set up properly and shapes what we build next. If you run a gym and want to be one of them, talk to us — you will be dealing with the people who build it.",
  },
  pillars: {
    title: "Three things that change on day one",
    subtitle: "The parts of running a gym that cost you the most time and the most money.",
    items: [
      {
        title: "Check-in by QR code",
        body:
          "A member opens the app, scans the code at your front desk, and is in. No queue, no signing a book, no front-desk staff trying to remember whether someone has paid. An expired membership is caught at the door, not a month later.",
      },
      {
        title: "Memberships that chase themselves",
        body:
          "Every member, plan and expiry date in one place, with renewals and payments recorded as they happen. GymOS tells you who is about to lapse while you can still do something about it, and messages them over WhatsApp for you.",
      },
      {
        title: "You can finally see the gym",
        body:
          "Who came in today, which classes filled, what was collected this month, which members have stopped showing up. Real numbers from what actually happened, not an estimate you reconstruct at month end.",
      },
    ],
  },
  features: {
    title: "Everything the gym runs on",
    subtitle: "One system for the front desk, the floor, the coaches and the office.",
    items: [
      {
        title: "Members and subscriptions",
        body: "Enrol a member in minutes, assign a plan, track start and expiry dates, and renew without re-entering anything.",
      },
      {
        title: "Payments and receipts",
        body: "Record a payment the moment it is taken, by cash or mobile money, and keep a history you can actually audit.",
      },
      {
        title: "Attendance history",
        body: "Every check-in recorded automatically, per member and per day, so attendance questions have an answer.",
      },
      {
        title: "Classes and bookings",
        body: "Put your class timetable in the app, let members book a place, and see the roster before the session starts.",
      },
      {
        title: "Workout plans",
        body: "Build plans and assign them to members, so what a coach prescribed is in the member's pocket rather than on a sheet of paper.",
      },
      {
        title: "Coaches",
        body: "Give each coach their own view of their classes and the members assigned to them, without opening up the rest of the gym's data.",
      },
      {
        title: "Progress tracking",
        body: "Members log measurements and progress photos privately, and choose whether a coach sees them. Nothing is shared by default.",
      },
      {
        title: "Staff roles and permissions",
        body: "Front desk, coach, manager, owner — each role sees what it needs and nothing more, so you can delegate without handing over the gym.",
      },
      {
        title: "WhatsApp notifications",
        body: "Renewal reminders and account messages reach members where they already are, instead of in an inbox nobody opens.",
      },
      {
        title: "English and French",
        body: "The whole system, including the member app, works in both languages. Your staff and your members each pick their own.",
      },
    ],
  },
  how: {
    title: "How it works",
    subtitle: "Three steps, and we do most of the first one with you.",
    steps: [
      {
        title: "We set your gym up",
        body: "We create your gym, your plans and your staff accounts with you, and import the members you already have. You do not start from an empty screen.",
      },
      {
        title: "Your members get the app",
        body: "They download GymOS on Android or iPhone, sign in with their phone number, and from then on check in by scanning the code at your door.",
      },
      {
        title: "You run it from the dashboard",
        body: "Everything else — payments, renewals, classes, staff, reports — happens in your dashboard, from a laptop or a phone, wherever you are.",
      },
    ],
  },
  app: {
    title: "Your members get a real app, not a web page",
    body:
      "GymOS Member App is on both stores. Members use it to check in by QR code, see their membership and expiry date, book classes, follow the workout plan their coach assigned, and track their own progress.",
    appStore: "Download on the App Store",
    playStore: "Get it on Google Play",
    note: "Free for your members. Included with your gym's subscription.",
  },
  testimonials: {
    title: "What gym owners say",
    subtitle: "From gyms running GymOS day to day.",
    items: [],
  },
  proof: {
    title: "Why gym owners move to GymOS",
    subtitle: "The three problems we hear in every single conversation with a gym owner.",
    items: [
      {
        title: "“I do not know who has actually paid.”",
        body:
          "The notebook says one thing, the member says another, and nobody can check. With GymOS the membership is either valid at the door or it is not, and the payment that made it valid is on the record with a date against it.",
      },
      {
        title: "“Members disappear and I find out too late.”",
        body:
          "A member stops coming three weeks before their renewal and nobody notices until the money does not arrive. GymOS surfaces the drop in attendance and the approaching expiry while there is still time to pick up the phone.",
      },
      {
        title: "“I cannot leave the gym without it slipping.”",
        body:
          "Everything lives in the owner's head, so nothing runs properly when the owner is away. Roles let you hand the front desk, the floor and the coaching to the people doing them, and still see all of it from your phone.",
      },
    ],
  },
  cta: {
    title: "Run a gym? Let's talk.",
    body:
      "Tell us how your gym works today and we will show you exactly what GymOS would change — no slide deck, no commitment. We will answer on WhatsApp.",
    whatsapp: "Message us on WhatsApp",
    email: "Email us",
    prefilledMessage: "Hello GymOS, I run a gym and I would like to know more.",
  },
  footer: {
    tagline: "Gym management software for gym owners.",
    product: "Product",
    ownerLogin: "Owner login",
    memberApp: "Member app",
    company: "Company",
    contact: "Contact",
    privacy: "Privacy policy",
    facebook: "Facebook",
    poweredBy: "Powered by GetSocial",
    rights: "All rights reserved.",
  },
};

const fr: Copy = {
  meta: {
    title: "GymOS — Logiciel de gestion pour salles de sport",
    description:
      "Entrée par QR code, suivi des abonnements et des paiements, cours, programmes d'entraînement, et une application membre sur Android et iPhone. Conçu pour les gérants de salles.",
  },
  nav: {
    features: "Fonctionnalités",
    how: "Comment ça marche",
    app: "Application membre",
    contact: "Nous parler",
    login: "Espace gérant",
    switchTo: "English",
    switchLabel: "Changer de langue",
  },
  hero: {
    eyebrow: "Logiciel de gestion de salle de sport, conçu pour les gérants",
    title: "Gérez mieux votre salle. Enregistrez vos membres en un scan.",
    subtitle:
      "GymOS remplace le cahier, le tableur et le groupe WhatsApp par un seul système : vos membres scannent un QR code pour entrer, les abonnements se renouvellent à temps, et vous voyez ce qui se passe réellement dans votre salle depuis votre téléphone.",
    primaryCta: "Discuter sur WhatsApp",
    primaryCtaEmail: "Nous écrire",
    secondaryCta: "Voir ce que ça fait",
  },
  earlyAccess: {
    badge: "Nous accueillons nos premières salles",
    title: "Nous installons nos salles fondatrices en ce moment.",
    body:
      "GymOS est en service aujourd'hui, et nous accueillons volontairement un petit nombre de salles d'abord : chacune est installée correctement et oriente ce que nous construisons ensuite. Si vous gérez une salle et voulez en faire partie, parlons-en — vous aurez affaire à ceux qui construisent le produit.",
  },
  pillars: {
    title: "Trois choses qui changent dès le premier jour",
    subtitle: "Ce qui vous coûte le plus de temps et le plus d'argent dans la gestion d'une salle.",
    items: [
      {
        title: "Entrée par QR code",
        body:
          "Le membre ouvre l'application, scanne le code à l'accueil, et c'est fait. Pas de file d'attente, pas de registre à signer, pas d'agent d'accueil qui essaie de se souvenir si quelqu'un a payé. Un abonnement expiré est détecté à la porte, pas un mois plus tard.",
      },
      {
        title: "Des abonnements qui se relancent seuls",
        body:
          "Chaque membre, chaque formule et chaque date d'échéance au même endroit, avec les renouvellements et les paiements enregistrés au fur et à mesure. GymOS vous signale qui est sur le point d'expirer pendant que vous pouvez encore agir, et les relance sur WhatsApp à votre place.",
      },
      {
        title: "Vous voyez enfin votre salle",
        body:
          "Qui est venu aujourd'hui, quels cours se sont remplis, ce qui a été encaissé ce mois-ci, quels membres ne viennent plus. Des chiffres réels, issus de ce qui s'est passé, et non une estimation reconstituée en fin de mois.",
      },
    ],
  },
  features: {
    title: "Tout ce qui fait tourner la salle",
    subtitle: "Un seul système pour l'accueil, le plateau, les coachs et le bureau.",
    items: [
      {
        title: "Membres et abonnements",
        body: "Inscrivez un membre en quelques minutes, attribuez une formule, suivez les dates de début et d'échéance, et renouvelez sans tout ressaisir.",
      },
      {
        title: "Paiements et reçus",
        body: "Enregistrez un paiement au moment où vous l'encaissez, en espèces ou par mobile money, et gardez un historique réellement vérifiable.",
      },
      {
        title: "Historique de présence",
        body: "Chaque entrée enregistrée automatiquement, par membre et par jour : les questions de présence ont enfin une réponse.",
      },
      {
        title: "Cours et réservations",
        body: "Mettez votre planning de cours dans l'application, laissez les membres réserver leur place, et voyez la liste avant le début de la séance.",
      },
      {
        title: "Programmes d'entraînement",
        body: "Créez des programmes et attribuez-les à vos membres : ce que le coach a prescrit est dans la poche du membre, plus sur une feuille de papier.",
      },
      {
        title: "Coachs",
        body: "Donnez à chaque coach sa propre vue de ses cours et des membres qui lui sont attribués, sans ouvrir le reste des données de la salle.",
      },
      {
        title: "Suivi des progrès",
        body: "Les membres enregistrent leurs mesures et leurs photos de progression en privé, et choisissent si un coach peut les voir. Rien n'est partagé par défaut.",
      },
      {
        title: "Rôles et permissions du personnel",
        body: "Accueil, coach, manager, gérant : chaque rôle voit ce dont il a besoin et rien de plus. Vous déléguez sans céder la salle.",
      },
      {
        title: "Notifications WhatsApp",
        body: "Les rappels de renouvellement et les messages de compte arrivent là où vos membres sont déjà, et non dans une boîte mail que personne n'ouvre.",
      },
      {
        title: "Français et anglais",
        body: "Tout le système, application membre comprise, fonctionne dans les deux langues. Votre personnel et vos membres choisissent chacun la leur.",
      },
    ],
  },
  how: {
    title: "Comment ça marche",
    subtitle: "Trois étapes, et nous faisons l'essentiel de la première avec vous.",
    steps: [
      {
        title: "Nous installons votre salle",
        body: "Nous créons avec vous votre salle, vos formules et les comptes de votre personnel, et nous importons les membres que vous avez déjà. Vous ne démarrez pas devant un écran vide.",
      },
      {
        title: "Vos membres installent l'application",
        body: "Ils téléchargent GymOS sur Android ou iPhone, se connectent avec leur numéro de téléphone, et scannent ensuite le code à votre entrée pour chaque passage.",
      },
      {
        title: "Vous pilotez depuis le tableau de bord",
        body: "Tout le reste — paiements, renouvellements, cours, personnel, rapports — se passe dans votre tableau de bord, sur ordinateur ou sur téléphone, où que vous soyez.",
      },
    ],
  },
  app: {
    title: "Vos membres ont une vraie application, pas une page web",
    body:
      "GymOS Member App est disponible sur les deux stores. Les membres s'en servent pour entrer par QR code, consulter leur abonnement et sa date d'échéance, réserver des cours, suivre le programme attribué par leur coach et suivre leurs propres progrès.",
    appStore: "Télécharger sur l'App Store",
    playStore: "Disponible sur Google Play",
    note: "Gratuite pour vos membres. Incluse dans l'abonnement de votre salle.",
  },
  testimonials: {
    title: "Ce qu'en disent les gérants",
    subtitle: "Des salles qui utilisent GymOS au quotidien.",
    items: [],
  },
  proof: {
    title: "Pourquoi les gérants passent à GymOS",
    subtitle: "Les trois problèmes qui reviennent dans chacune de nos conversations avec un gérant de salle.",
    items: [
      {
        title: "« Je ne sais pas qui a réellement payé. »",
        body:
          "Le cahier dit une chose, le membre en dit une autre, et personne ne peut vérifier. Avec GymOS, l'abonnement est valide à la porte ou il ne l'est pas, et le paiement qui l'a rendu valide est enregistré avec sa date.",
      },
      {
        title: "« Des membres disparaissent et je m'en aperçois trop tard. »",
        body:
          "Un membre cesse de venir trois semaines avant son renouvellement et personne ne le remarque jusqu'à ce que l'argent n'arrive pas. GymOS fait remonter la baisse de fréquentation et l'échéance qui approche pendant qu'il est encore temps d'appeler.",
      },
      {
        title: "« Je ne peux pas m'absenter sans que ça dérape. »",
        body:
          "Tout est dans la tête du gérant, donc plus rien ne tourne correctement quand il n'est pas là. Les rôles vous permettent de confier l'accueil, le plateau et le coaching à ceux qui les font, tout en gardant une vue complète depuis votre téléphone.",
      },
    ],
  },
  cta: {
    title: "Vous gérez une salle ? Parlons-en.",
    body:
      "Dites-nous comment votre salle fonctionne aujourd'hui et nous vous montrerons exactement ce que GymOS y changerait — sans présentation commerciale, sans engagement. Nous répondons sur WhatsApp.",
    whatsapp: "Nous écrire sur WhatsApp",
    email: "Nous écrire",
    prefilledMessage: "Bonjour GymOS, je gère une salle de sport et j'aimerais en savoir plus.",
  },
  footer: {
    tagline: "Logiciel de gestion pour les gérants de salles de sport.",
    product: "Produit",
    ownerLogin: "Espace gérant",
    memberApp: "Application membre",
    company: "Entreprise",
    contact: "Contact",
    privacy: "Politique de confidentialité",
    facebook: "Facebook",
    poweredBy: "Propulsé par GetSocial",
    rights: "Tous droits réservés.",
  },
};

export const COPY: Record<Locale, Copy> = { en, fr };
