import type { Locale } from "@/lib/i18n/config";

/**
 * The GymOS privacy policy, as served at /privacy.
 *
 * Why this lives in a typed module rather than `locales/{en,fr}.json`:
 * `Record<Locale, PrivacyPolicyDocument>` plus `Record<SectionId, PolicySection>`
 * makes EN/FR parity a *compile* error, not just a CI key-parity failure --
 * and for a legal document, a section silently missing from one language is
 * the failure mode that matters. It also keeps ~200 lines of legal prose,
 * which changes on counsel's schedule rather than the product's, out of the
 * UI string files. The i18n lint gate is unaffected: the page renders these
 * as expressions, never as JSX literals.
 *
 * The data inventory below is derived from the same source as
 * `docs/play-store-data-safety.md` (the migrations, the wired SDKs, and
 * `apps/mobile/app.json`'s permissions). **Keep the two in sync** -- a
 * divergence between the Play data-safety declaration and the published
 * policy is exactly what a store review flags.
 *
 * `{{token}}` placeholders are filled from `LEGAL_DETAILS` at render time.
 */

export type SectionId =
  | "scope"
  | "collect"
  | "analytics"
  | "sharing"
  | "retention"
  | "choices"
  | "children"
  | "security"
  | "changes"
  | "contact";

/** Rendering order. A `Record` preserves insertion order in practice, but
 *  relying on that for a legal document's section sequence is implicit --
 *  this makes it explicit and identical across locales. */
export const SECTION_ORDER: readonly SectionId[] = [
  "scope",
  "collect",
  "analytics",
  "sharing",
  "retention",
  "choices",
  "children",
  "security",
  "changes",
  "contact",
];

export interface PolicyTable {
  headers: string[];
  rows: string[][];
}

export interface PolicySection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
  table?: PolicyTable;
}

export interface PrivacyPolicyDocument {
  title: string;
  lastUpdatedLabel: string;
  intro: string;
  sections: Record<SectionId, PolicySection>;
  draft: {
    title: string;
    body: string;
    fieldLabels: Record<string, string>;
  };
}

const EN: PrivacyPolicyDocument = {
  title: "GymOS Privacy Policy",
  lastUpdatedLabel: "Last updated",
  intro:
    "GymOS is a gym management platform used by gym staff and their members. This policy explains what information GymOS collects, why it is collected, and how it is handled.",
  sections: {
    scope: {
      heading: "1. Who this applies to",
      paragraphs: [
        "This policy covers the GymOS mobile app (used by gym members) and the GymOS dashboard (used by gym staff).",
        "If you are a gym member, the gym that enrolled you is your point of contact. GymOS is the software platform your gym uses to run its membership; it is not a service you sign up for independently of your gym.",
      ],
    },
    collect: {
      heading: "2. Information we collect",
      table: {
        headers: ["Category", "What", "Why"],
        rows: [
          [
            "Identity",
            "Name, phone number, optional email address, optional date of birth",
            "Creating your account, signing you in with a one-time code sent to your phone, and identifying you at check-in",
          ],
          [
            "Profile photo",
            "A profile picture, if you add one",
            "Shown to gym staff so they can identify you",
          ],
          [
            "Safety",
            "Emergency contact, if you provide one",
            "Made available to gym staff only in an emergency",
          ],
          [
            "Fitness onboarding",
            "The goal and experience level you select when you first set up the app",
            "Personalising the plan suggested to you",
          ],
          [
            "Body measurements",
            "Weight and body measurements (waist, chest, hips, arms, thighs) that you choose to log, and any note you attach to an entry",
            "Showing you your own progress over time. Entirely optional — the app works without logging any of it",
          ],
          [
            "Progress photos",
            "Photos you choose to attach to a progress entry",
            "Showing you your own progress over time. Private to you by default; shared with your assigned coach only for the specific photos you choose to share, and you can stop sharing a photo at any time",
          ],
          [
            "Attendance",
            "Check-in and check-out times at your gym",
            "Gym occupancy tracking and your own attendance history",
          ],
          [
            "Classes and training",
            "Class bookings, and which exercises in your plan you mark as done",
            "Running class capacity and showing you and your coach your training progress",
          ],
          [
            "Payments",
            "Payment amount, currency, method and status",
            "Billing and subscription management. We do not store your card number or any other raw payment credential — payments are processed by our payment partner, Tara Money, who handles that data directly",
          ],
          [
            "Coach notes",
            "Session notes written by your assigned coach, if your gym uses coaching",
            "Shared between you, your coach, and the gym staff who need them for your training",
          ],
          [
            "Notifications",
            "A push token identifying your device, your notification preferences, and a history of the notifications sent to you",
            "Delivering and displaying app notifications such as subscription reminders and payment confirmations",
          ],
        ],
      },
      paragraphs: [
        "We do not collect your location or GPS data, your contacts, your calendar, your browsing or search history, or any audio or microphone data.",
      ],
    },
    analytics: {
      heading: "3. Analytics and error reporting",
      paragraphs: [
        "The mobile app reports a small, fixed set of product-analytics events to PostHog: that the app was opened, that a progress entry was logged, and that a plan exercise was marked complete. These events deliberately carry no measurement values, no photos, no note text, and no name, phone number or email address — a progress entry, for example, is reported only as whether a weight was included and how many measurements were filled in, never the numbers themselves. The app does not tell PostHog who you are; the events are tied to an anonymous identifier generated on your device.",
        "The app also reports crashes and technical errors to Sentry, so that a fault can be diagnosed and fixed. These reports contain technical diagnostic information — the error itself, the device model and operating system version — and are configured not to attach personal information.",
      ],
    },
    sharing: {
      heading: "4. Who we share information with",
      bullets: [
        "Tara Money — our payment processor, to complete a payment you initiate.",
        "Expo — our push notification infrastructure, to deliver notifications to your device.",
        "Our messaging providers (Evolution API, Twilio and sent.dm) — to send the one-time code you use to sign in, and membership invitations, to your phone number.",
        "PostHog — for the limited, anonymous product analytics described above.",
        "Sentry — for the crash and error reports described above.",
        "Supabase — our hosting and database provider, which stores the information above on our behalf.",
        "Your gym — gym staff (owners, managers, receptionists and coaches, according to their role) can see the information relevant to running your membership and your training, and nothing beyond their role.",
      ],
      paragraphs: [
        "We do not sell your information, and we do not share it for advertising or third-party marketing purposes.",
      ],
    },
    retention: {
      heading: "5. How long we keep information",
      paragraphs: [
        "We keep your information {{retentionPeriod}}.",
        "Attendance, payment and audit records may be kept for longer where we are required to retain them for financial or legal record-keeping.",
      ],
    },
    choices: {
      heading: "6. Your choices and your rights",
      paragraphs: [
        "You can update your profile details, your progress entries, your notification preferences and your language directly in the app. You can stop sharing a progress photo with your coach at any time.",
        "To request a copy, a correction, or the deletion of your information, contact your gym, or write to us at {{supportEmail}}. There is no in-app delete button today: deletion requests are handled manually. Tell us the phone number your account uses and which gym you belong to, and we will confirm your identity with your gym, delete the information we are not legally required to keep, and confirm to you when it is done.",
        "Some records cannot be deleted on request — payment and audit records we are required to retain for financial or legal record-keeping. Where that applies, we will tell you what was kept and why.",
      ],
    },
    children: {
      heading: "7. Children's privacy",
      paragraphs: [
        "GymOS is not directed at children under {{minimumAge}}, and we do not knowingly collect information from children below that age. If you believe a child has provided us with information, contact us at {{supportEmail}} and we will delete it.",
      ],
    },
    security: {
      heading: "8. Security",
      paragraphs: [
        "Information is encrypted in transit using HTTPS/TLS, and encrypted at rest by our hosting provider. Payment credentials belonging to a gym are held in an encrypted secrets store and are never returned to any app.",
        "Access is restricted by role and by gym: staff can only see information belonging to their own gym, and only the parts their role requires. Progress photos are stored in a private location and are reachable only through short-lived links issued to you, or to a coach for a photo you have chosen to share.",
      ],
    },
    changes: {
      heading: "9. Changes to this policy",
      paragraphs: [
        "We may update this policy from time to time. When we do, we will change the date shown at the top of this page. If a change materially affects how your information is used, we will make that clear in the app.",
      ],
    },
    contact: {
      heading: "10. Contact us",
      paragraphs: ["{{legalEntity}}", "{{address}}", "{{supportEmail}}"],
    },
  },
  draft: {
    title: "Unpublished draft — not valid for a store listing",
    body: "This policy is not ready to be published. The following details have not been supplied yet in lib/legal/details.ts, and the text below still contains placeholders in their place:",
    fieldLabels: {
      legalEntity: "Legal entity name",
      address: "Registered address",
      supportEmail: "Support email address",
      retentionPeriod: "Data retention period",
      minimumAge: "Minimum age",
    },
  },
};

const FR: PrivacyPolicyDocument = {
  title: "Politique de confidentialité GymOS",
  lastUpdatedLabel: "Dernière mise à jour",
  intro:
    "GymOS est une plateforme de gestion de salle de sport utilisée par le personnel des salles et par leurs membres. Cette politique explique quelles informations GymOS collecte, pourquoi, et comment elles sont traitées.",
  sections: {
    scope: {
      heading: "1. À qui s'applique cette politique",
      paragraphs: [
        "Cette politique couvre l'application mobile GymOS (utilisée par les membres) et le tableau de bord GymOS (utilisé par le personnel de la salle).",
        "Si vous êtes membre d'une salle, votre interlocuteur est la salle qui vous a inscrit. GymOS est la plateforme logicielle que votre salle utilise pour gérer ses adhésions ; ce n'est pas un service auquel vous souscrivez indépendamment de votre salle.",
      ],
    },
    collect: {
      heading: "2. Informations que nous collectons",
      table: {
        headers: ["Catégorie", "Quoi", "Pourquoi"],
        rows: [
          [
            "Identité",
            "Nom, numéro de téléphone, adresse e-mail facultative, date de naissance facultative",
            "Créer votre compte, vous connecter à l'aide d'un code à usage unique envoyé sur votre téléphone, et vous identifier à l'accueil",
          ],
          [
            "Photo de profil",
            "Une photo de profil, si vous en ajoutez une",
            "Affichée au personnel de la salle afin qu'il puisse vous identifier",
          ],
          [
            "Sécurité",
            "Contact d'urgence, si vous en fournissez un",
            "Mis à la disposition du personnel de la salle uniquement en cas d'urgence",
          ],
          [
            "Profil sportif",
            "L'objectif et le niveau d'expérience que vous choisissez lors de la configuration initiale",
            "Personnaliser le programme qui vous est proposé",
          ],
          [
            "Mensurations",
            "Le poids et les mensurations (taille, poitrine, hanches, bras, cuisses) que vous choisissez d'enregistrer, ainsi que toute note associée à une entrée",
            "Vous montrer votre propre progression dans le temps. Entièrement facultatif — l'application fonctionne sans que vous n'enregistriez aucune de ces données",
          ],
          [
            "Photos de progression",
            "Les photos que vous choisissez d'associer à une entrée de progression",
            "Vous montrer votre propre progression dans le temps. Privées par défaut ; partagées avec votre coach attitré uniquement pour les photos que vous choisissez de partager, et vous pouvez cesser de partager une photo à tout moment",
          ],
          [
            "Présence",
            "Vos heures d'arrivée et de départ dans votre salle",
            "Le suivi de la fréquentation de la salle et votre propre historique de présence",
          ],
          [
            "Cours et entraînement",
            "Vos réservations de cours et les exercices de votre programme que vous marquez comme effectués",
            "Gérer la capacité des cours et vous montrer, à vous et à votre coach, votre progression",
          ],
          [
            "Paiements",
            "Montant, devise, moyen et statut du paiement",
            "La facturation et la gestion des abonnements. Nous ne conservons ni votre numéro de carte ni aucune autre donnée de paiement brute — les paiements sont traités par notre partenaire de paiement, Tara Money, qui traite ces données directement",
          ],
          [
            "Notes de coach",
            "Les notes de séance rédigées par votre coach attitré, si votre salle propose du coaching",
            "Partagées entre vous, votre coach et le personnel de la salle qui en a besoin pour votre entraînement",
          ],
          [
            "Notifications",
            "Un jeton d'identification de votre appareil, vos préférences de notification et l'historique des notifications qui vous ont été envoyées",
            "Envoyer et afficher les notifications de l'application, par exemple les rappels d'abonnement et les confirmations de paiement",
          ],
        ],
      },
      paragraphs: [
        "Nous ne collectons pas votre position ou vos données GPS, vos contacts, votre agenda, votre historique de navigation ou de recherche, ni aucune donnée audio ou micro.",
      ],
    },
    analytics: {
      heading: "3. Analyse d'usage et rapports d'erreur",
      paragraphs: [
        "L'application mobile transmet à PostHog un ensemble restreint et fixe d'événements d'analyse produit : l'ouverture de l'application, l'enregistrement d'une entrée de progression, et le fait de marquer un exercice comme effectué. Ces événements ne contiennent délibérément aucune valeur de mensuration, aucune photo, aucun texte de note, ni nom, numéro de téléphone ou adresse e-mail — une entrée de progression, par exemple, est transmise uniquement sous la forme « un poids a-t-il été renseigné » et « combien de mensurations ont été remplies », jamais les valeurs elles-mêmes. L'application n'indique pas à PostHog qui vous êtes ; les événements sont rattachés à un identifiant anonyme généré sur votre appareil.",
        "L'application transmet également les plantages et erreurs techniques à Sentry, afin qu'un dysfonctionnement puisse être diagnostiqué et corrigé. Ces rapports contiennent des informations techniques de diagnostic — l'erreur elle-même, le modèle de l'appareil et la version du système d'exploitation — et sont configurés pour ne pas y joindre d'informations personnelles.",
      ],
    },
    sharing: {
      heading: "4. Avec qui nous partageons vos informations",
      bullets: [
        "Tara Money — notre prestataire de paiement, pour finaliser un paiement que vous initiez.",
        "Expo — notre infrastructure de notifications push, pour envoyer les notifications à votre appareil.",
        "Nos prestataires de messagerie (Evolution API, Twilio et sent.dm) — pour envoyer à votre numéro de téléphone le code à usage unique qui vous sert à vous connecter, ainsi que les invitations d'adhésion.",
        "PostHog — pour l'analyse produit limitée et anonyme décrite ci-dessus.",
        "Sentry — pour les rapports de plantage et d'erreur décrits ci-dessus.",
        "Supabase — notre hébergeur et fournisseur de base de données, qui stocke pour notre compte les informations ci-dessus.",
        "Votre salle — le personnel de la salle (propriétaires, gérants, réceptionnistes et coachs, selon leur rôle) peut consulter les informations nécessaires à la gestion de votre adhésion et de votre entraînement, et rien au-delà de son rôle.",
      ],
      paragraphs: [
        "Nous ne vendons pas vos informations et nous ne les partageons pas à des fins publicitaires ou de marketing par des tiers.",
      ],
    },
    retention: {
      heading: "5. Durée de conservation",
      paragraphs: [
        "Nous conservons vos informations {{retentionPeriod}}.",
        "Les enregistrements de présence, de paiement et d'audit peuvent être conservés plus longtemps lorsque nous sommes tenus de les conserver à des fins comptables ou légales.",
      ],
    },
    choices: {
      heading: "6. Vos choix et vos droits",
      paragraphs: [
        "Vous pouvez modifier vous-même, dans l'application, les informations de votre profil, vos entrées de progression, vos préférences de notification et votre langue. Vous pouvez cesser de partager une photo de progression avec votre coach à tout moment.",
        "Pour demander une copie, une correction ou la suppression de vos informations, contactez votre salle ou écrivez-nous à {{supportEmail}}. Il n'existe pas aujourd'hui de bouton de suppression dans l'application : les demandes de suppression sont traitées manuellement. Indiquez-nous le numéro de téléphone associé à votre compte et la salle dont vous êtes membre ; nous vérifierons votre identité auprès de votre salle, supprimerons les informations que nous ne sommes pas légalement tenus de conserver, et vous confirmerons lorsque ce sera fait.",
        "Certaines données ne peuvent pas être supprimées sur demande — les enregistrements de paiement et d'audit que nous sommes tenus de conserver à des fins comptables ou légales. Le cas échéant, nous vous indiquerons ce qui a été conservé et pourquoi.",
      ],
    },
    children: {
      heading: "7. Protection des mineurs",
      paragraphs: [
        "GymOS ne s'adresse pas aux enfants de moins de {{minimumAge}} ans et nous ne collectons pas sciemment d'informations les concernant. Si vous pensez qu'un enfant nous a transmis des informations, écrivez-nous à {{supportEmail}} et nous les supprimerons.",
      ],
    },
    security: {
      heading: "8. Sécurité",
      paragraphs: [
        "Les informations sont chiffrées lors de leur transmission (HTTPS/TLS) et chiffrées au repos par notre hébergeur. Les identifiants de paiement appartenant à une salle sont conservés dans un coffre-fort chiffré et ne sont jamais transmis à une application cliente.",
        "L'accès est restreint par rôle et par salle : le personnel ne peut consulter que les informations de sa propre salle, et uniquement celles que son rôle exige. Les photos de progression sont stockées dans un espace privé et ne sont accessibles que par des liens de courte durée émis pour vous, ou pour un coach s'agissant d'une photo que vous avez choisi de partager.",
      ],
    },
    changes: {
      heading: "9. Modifications de cette politique",
      paragraphs: [
        "Nous pouvons mettre à jour cette politique de temps à autre. Le cas échéant, nous modifierons la date indiquée en haut de cette page. Si une modification affecte de manière significative l'usage de vos informations, nous vous l'indiquerons clairement dans l'application.",
      ],
    },
    contact: {
      heading: "10. Nous contacter",
      paragraphs: ["{{legalEntity}}", "{{address}}", "{{supportEmail}}"],
    },
  },
  draft: {
    title: "Brouillon non publié — non valable pour une fiche de store",
    body: "Cette politique n'est pas prête à être publiée. Les éléments suivants n'ont pas encore été renseignés dans lib/legal/details.ts, et le texte ci-dessous contient encore des espaces réservés à leur place :",
    fieldLabels: {
      legalEntity: "Raison sociale",
      address: "Adresse du siège",
      supportEmail: "Adresse e-mail de contact",
      retentionPeriod: "Durée de conservation",
      minimumAge: "Âge minimum",
    },
  },
};

export const PRIVACY_POLICY: Record<Locale, PrivacyPolicyDocument> = { en: EN, fr: FR };
