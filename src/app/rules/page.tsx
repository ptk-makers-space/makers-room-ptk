import Link from 'next/link';

import { loadPolicy } from '@/lib/bookings/service';
import { DEFAULT_POLICY } from '@/lib/scheduling';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'כללי ההזמנות · MakersRoom PTK' };

/** Public page, so read the admin-tuned rules with the service client. */
async function loadPublicPolicy() {
  if (!isSupabaseConfigured()) return DEFAULT_POLICY;
  try {
    return await loadPolicy(createAdminClient());
  } catch {
    return DEFAULT_POLICY;
  }
}

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "ראשון–חמישי" for a contiguous run of working days. */
function workingDaysLabel(days: number[]): string {
  if (days.length === 0) return '';
  const first = DAY_NAMES_HE[days[0]];
  const last = DAY_NAMES_HE[days[days.length - 1]];
  return first === last ? first : `${first}–${last}`;
}

/** Hebrew-friendly duration text, e.g. "שעתיים ו-30 דקות". */
function formatMinutesHe(total: number): string {
  const rounded = Math.round(total);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;

  const hoursText = hours === 1 ? 'שעה' : hours === 2 ? 'שעתיים' : `${hours} שעות`;
  const minutesText = minutes === 1 ? 'דקה' : `${minutes} דקות`;

  if (hours === 0) return minutesText;
  if (minutes === 0) return hoursText;
  return `${hoursText} ו-${minutesText}`;
}

/**
 * Public explainer for the house rules. Kept readable without a session so a
 * prospective member can see how the queue works before signing in.
 */
export default async function RulesPage() {
  const policy = await loadPublicPolicy();
  const workingDays = workingDaysLabel(policy.workingDays);

  return (
    <main dir="rtl" lang="he" className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
        → חזרה ללוח הזמנים
      </Link>

      <h1 className="mt-6 text-2xl font-semibold text-slate-900">איך התור עובד</h1>
      <p className="mt-2 text-slate-600">
        שתי מדפסות, סדנה משותפת אחת. הכללים האלה שומרים על המכונות עסוקות, מונעים
        ממישהו אחד לתפוס את כל שעות היום, ומוודאים שעבודה דחופה עדיין יכולה לעבור.
      </p>

      <Rule title="אין הגבלת אורך על הדפסה">
        <p>
          הדפסה יכולה לרוץ כמה זמן שצריך — אין תקרה ליום ואין תקרה ללילה. מה שקובע הוא
          המכסה בשעות העבודה, לא אורך ההדפסה עצמו.
        </p>
      </Rule>

      <Rule title="המלצה: הדפסות ארוכות ללילה">
        <p>
          להדפסה ארוכה מ־{formatMinutesHe(policy.longPrintThresholdMinutes)} נציע (ולא
          נחסום) להתחיל בחלון הלילה (
          <span dir="ltr">
            {policy.overnightStartHour}:00–{policy.overnightEndHour}:00
          </span>
          ). זה כדאי גם לכם: שעות הלילה לא נספרות במכסת שעות העבודה החודשית ולא במכסת
          הדפסת היום השבועית, כך שההדפסה הארוכה רצה בלילה והמכסה היומית שלכם נשארת
          פנויה להדפסות נוספות.
        </p>
      </Rule>

      {policy.bufferMinutes > 0 ? (
        <Rule title={`${policy.bufferMinutes} דקות ניקיון בין הדפסות`}>
          <p>
            בין שתי הדפסות על אותה מדפסת חייבות לעבור לפחות {policy.bufferMinutes} דקות,
            כדי לפנות את המשטח ולהכין את ההדפסה הבאה. אפשר לבחור שעות בקפיצות של{' '}
            {policy.slotGranularityMinutes} דקות.
          </p>
        </Rule>
      ) : (
        <Rule title="אפשר להזמין צמוד להדפסה הקודמת">
          <p>
            אין זמן מעבר חובה בין הדפסות: אם מישהו מזמין עד{' '}
            <span dir="ltr">12:00</span>, ההזמנה הבאה יכולה להתחיל ב־
            <span dir="ltr">12:00</span> בדיוק. אפשר לבחור שעות בקפיצות של{' '}
            {policy.slotGranularityMinutes} דקות.
          </p>
        </Rule>
      )}

      <Rule title="הצטרפו אליי — הדפסה משותפת">
        <p>
          בכל הזמנה אפשר לסמן <strong>&quot;שאחרים יוכלו להצטרף&quot;</strong>. חברים
          אחרים יראו את המשבצת מסומנת ב־👥 ויוכלו להצטרף אליה בלחיצה, להניח את החלקים
          שלהם על אותו משטח ולחסוך הדפסה נפרדת.
        </p>
        <p className="mt-2">
          הצטרפות <strong>לא נחשבת</strong> בזמן ההדפסה של המצטרף: היא לא נספרת במכסת
          הדפסות היום השבועית, לא במכסה החודשית ולא במספר ההזמנות הפתוחות. רק בעל
          המשבצת משלם עליה מהמכסה שלו.
        </p>
      </Rule>

      <Rule title="מכסת הדפסות היום בשבוע עבודה">
        <p>
          בשבוע עבודה ({workingDays}) אפשר להחזיק עד{' '}
          {policy.maxPrintsPerWorkingWeek === 1
            ? 'הדפסת יום אחת'
            : `${policy.maxPrintsPerWorkingWeek} הדפסות יום`}
          . הדפסות שמתחילות בלילה או בסוף השבוע לא נספרות בכלל — שם הקיבולת פנויה,
          וכדאי לנצל אותה.
        </p>
      </Rule>

      <Rule title="מכסה חודשית בשעות העבודה">
        <p>
          בכל חודש קלנדרי אפשר לצבור עד{' '}
          {formatMinutesHe(policy.monthlyWorkingMinutesCap)} של הדפסה בשעות העבודה (
          <span dir="ltr">
            {policy.primeTimeStartHour}:00–{policy.primeTimeEndHour}:00
          </span>
          , {workingDays}). נספר רק החלק של ההדפסה שנופל בשעות האלה, כך שהדפסות לילה
          וסופי שבוע לא מכרסמות במכסה.
        </p>
      </Rule>

      <Rule title="עבודה דחופה קודמת להדפסות להנאה">
        <p>
          הזמנות מסומנות כ<strong>הנאה</strong>, <strong>עבודה</strong> או{' '}
          <strong>עבודה דחופה</strong>. עבודה דחופה יכולה להשתלט על משבצת שתפוסה על ידי
          הדפסה להנאה; בעל המשבצת מקבל הודעה במייל ובטלפון באופן מיידי. הזמנה דחופה
          לעולם לא דוחקת עבודה אחרת, ולעולם לא דוחקת הדפסה שכבר התחילה.
        </p>
        <p className="mt-2">
          אין מגבלה על כמות ההזמנות הדחופות — רק צריך לכתוב בשורה אחת למה זה דחוף, כדי
          שמי שנדחק יבין מה קרה.
        </p>
      </Rule>

      <Rule title="הזמנות פתוחות בו־זמנית">
        <p>
          אפשר להחזיק עד {policy.maxActiveReservations} הזמנות עתידיות במקביל, כדי
          שאי אפשר יהיה לתפוס מראש שורה ארוכה של משבצות. אין מגבלה על כמה רחוק קדימה
          מזמינים — הלוח פתוח לכל תאריך עתידי.
        </p>
      </Rule>

      <Rule title={`משבצות פנויות נפתחות לכולם ${policy.openBookingHours} שעות מראש`}>
        <p>
          בתוך {policy.openBookingHours} שעות משעת ההתחלה כל המכסות מבוטלות. אם משבצת
          עדיין ריקה, כל אחד יכול לקחת אותה גם אם ניצל את המכסה השבועית או החודשית —
          מדפסת שעומדת בחוסר מעש לא עוזרת לאף אחד.
        </p>
      </Rule>

      <Rule title="פרטי קשר">
        <p>
          לכל חבר שמורים כתובת מייל ומספר טלפון. הם גלויים לחברים מחוברים אחרים, כדי
          שאפשר יהיה לטפל במהירות בהדפסה שנכשלה, במשטח תפוס או במשבצת שנדחקה.
        </p>
      </Rule>

      <p className="mt-10 text-sm text-slate-400">
        מנהלים יכולים לכוונן כל מספר שמופיע כאן בלי פריסה מחדש.
      </p>
    </main>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <div className="mt-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}
