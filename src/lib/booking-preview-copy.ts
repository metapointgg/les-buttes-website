import type {SiteLanguage} from './i18n';

const copy={
  en:{
    review:'Private feature preview',headline:'Plan your stay',intro:'Explore how direct booking will work at Les Buttes. Choose your cottage and dates to see an indicative direct price.',
    privacyNote:'Preview only — no guest details are collected and no reservation is created.',
    step1:'1. Your stay',step2:'2. Review the price',step3:'3. Request and confirmation',
    guidance:'Prices shown are a guide based on our October 2026 Airbnb calendar and a suggested direct-booking saving. Availability has not been checked.',
    button:'Preview an indicative quote',
    defaultPrompt:'Select your cottage, arrival and departure dates, then preview the indicative price.',
    over:'This cottage cannot accommodate that many guests.',
    invalidDates:'Enter valid dates for 1–27 nights.',
    capacity:'Please choose a valid number of guests.',
    outsideSeason:'Our proposed 2027 holiday season runs from 20 March to 2 October (checkout).',
    unavailableQuote:'We cannot calculate an estimate for those dates.',
    room:'Cottage',airbnb:'Equivalent Airbnb calendar rate',estimate:'Indicative direct total',saving:'Potential guest saving',nights:'nights',
    minimum:'Draft seasonal minimum',minimumMet:'Your stay meets the draft minimum.',minimumNotMet:'Your stay is shorter than the proposed minimum for these dates.',
    noAvailability:'Dates are NOT held or confirmed as available. We must check the current Airbnb and Les Buttes calendars before accepting a request.',
    estimated:'This is not a final offer. We review and agree every direct-booking price personally.',
    next:'What happens next?',nextCopy:'Once the booking service is launched, guests will send a request. We will verify availability, agree the final total and terms, then send a secure payment link. A booking is confirmed only after payment is checked.',
    back:'Book with Airbnb for now',contact:'Contact us about a stay',previewLabel:'Preview only • no payments or submissions',
    reset:'Change dates to recalculate',
  },
  nl:{
    review:'Besloten functievoorbeeld',headline:'Plan uw verblijf',intro:'Bekijk hoe rechtstreeks reserveren bij Les Buttes straks werkt. Kies uw huisje en data voor een indicatieve prijs.',
    privacyNote:'Alleen een voorbeeld — er worden geen gastgegevens verzameld en er wordt niets gereserveerd.',
    step1:'1. Uw verblijf',step2:'2. Bekijk de prijs',step3:'3. Aanvraag en bevestiging',
    guidance:'De prijzen zijn indicatief, gebaseerd op de Airbnb-kalender van oktober 2026 en een voorgestelde besparing bij rechtstreeks boeken. Beschikbaarheid is niet gecontroleerd.',
    button:'Indicatieve prijs bekijken',defaultPrompt:'Kies het huisje, de aankomst- en vertrekdata en bekijk de indicatieve prijs.',
    over:'Er zijn te veel gasten voor dit vakantiehuis.',invalidDates:'Vul geldige data in voor 1–27 nachten.',capacity:'Kies een geldig aantal gasten.',
    outsideSeason:'Het voorgestelde seizoen 2027 loopt van 20 maart tot 2 oktober (vertrek).',
    unavailableQuote:'Voor deze data kunnen we geen prijs berekenen.',
    room:'Vakantiehuis',airbnb:'Vergelijkbare Airbnb-kalenderprijs',estimate:'Indicatieve rechtstreekse prijs',saving:'Mogelijke besparing',nights:'nachten',
    minimum:'Voorgesteld minimumverblijf',minimumMet:'Uw verblijf voldoet aan het voorgestelde minimum.',minimumNotMet:'Uw verblijf is korter dan het voorgestelde minimum.',
    noAvailability:'De data zijn NIET vastgelegd of als beschikbaar bevestigd. We controleren altijd de actuele Airbnb- en Les Buttes-kalenders.',
    estimated:'Dit is geen definitieve offerte. We bespreken iedere rechtstreekse prijs persoonlijk.',
    next:'Hoe gaat het verder?',nextCopy:'Na de lancering kunnen gasten een aanvraag sturen. We controleren de beschikbaarheid, bevestigen prijs en voorwaarden en sturen daarna een veilige betaallink. De boeking wordt pas na controle van de betaling bevestigd.',
    back:'Boek voorlopig via Airbnb',contact:'Neem contact op over een verblijf',previewLabel:'Alleen voorbeeld • geen betalingen of aanvragen',
    reset:'Wijzig de data voor een nieuwe berekening'
  },
  fr:{
    review:'Aperçu privé',headline:'Préparez votre séjour',intro:'Découvrez comment fonctionnera la réservation directe aux Buttes. Sélectionnez un gîte et des dates pour voir une estimation.',
    privacyNote:'Aperçu seulement — aucune donnée personnelle n’est collectée et aucune réservation n’est créée.',
    step1:'1. Votre séjour',step2:'2. Consultez le tarif',step3:'3. Demande et confirmation',
    guidance:'Les prix sont indicatifs, fondés sur le calendrier Airbnb d’octobre 2026 et une économie proposée en direct. La disponibilité n’a pas été vérifiée.',
    button:'Calculer un tarif indicatif',defaultPrompt:'Choisissez un gîte, les dates d’arrivée et de départ, puis affichez une estimation.',
    over:'Ce gîte ne peut pas accueillir autant de personnes.',invalidDates:'Saisissez des dates valides pour 1 à 27 nuits.',capacity:'Choisissez un nombre de voyageurs valide.',
    outsideSeason:'La saison 2027 envisagée va du 20 mars au 2 octobre (départ).',
    unavailableQuote:'Impossible de calculer un prix indicatif pour ces dates.',
    room:'Gîte',airbnb:'Tarif comparable du calendrier Airbnb',estimate:'Total direct indicatif',saving:'Économie potentielle',nights:'nuits',
    minimum:'Séjour minimum envisagé',minimumMet:'Ce séjour respecte le minimum envisagé.',minimumNotMet:'Ce séjour est plus court que le minimum envisagé.',
    noAvailability:'Les dates ne sont NI bloquées ni confirmées comme disponibles. Nous devons vérifier les calendriers Airbnb et Les Buttes.',
    estimated:'Ce prix n’est pas une offre ferme. Chaque réservation directe fait l’objet d’une confirmation personnelle.',
    next:'Et ensuite ?',nextCopy:'Après le lancement, les voyageurs feront une demande. Nous vérifierons la disponibilité, confirmerons prix et conditions, puis enverrons un lien de paiement sécurisé. La réservation ne sera confirmée qu’après vérification du paiement.',
    back:'Réserver sur Airbnb pour le moment',contact:'Nous contacter pour un séjour',previewLabel:'Aperçu uniquement • aucun paiement ni envoi',
    reset:'Modifiez les dates pour recalculer'
  }
} as const;
export function bookingPreviewCopy(lang:SiteLanguage){return copy[lang];}
