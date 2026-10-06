import { Resend } from 'resend';

export type OtpMail = { to: string; otp: string; type: string };

/** Sends a login code. Without RESEND_API_KEY the code is printed instead (dev boxes). */
export async function sendOtpEmail({ to, otp, type }: OtpMail): Promise<void> {
  const subject =
    type === 'sign-in' ? `${otp} is your Alversjö login code` : `${otp} is your Alversjö verification code`;
  const text = `Your code is ${otp}. It expires in 5 minutes.\n\nIf you did not request it, ignore this email.`;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] to=${to} subject="${subject}"`);
    return;
  }
  const from = process.env.EMAIL_FROM ?? 'Alversjö <no-reply@notifications.alversjo.land>';
  const { error } = await new Resend(key).emails.send({ from, to: [to], subject, text });
  if (error) throw new Error(`Resend: ${error.message}`);
}

export type RenewalMail = { to: string; subject: string; body: string };

/** Sends a renewal-ask email. Without RESEND_API_KEY the message is printed instead (dev boxes). */
export async function sendRenewalEmail({ to, subject, body }: RenewalMail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] to=${to} subject="${subject}"`);
    return;
  }
  const from = process.env.EMAIL_FROM ?? 'Alversjö <no-reply@notifications.alversjo.land>';
  const { error } = await new Resend(key).emails.send({ from, to: [to], subject, text: body });
  if (error) throw new Error(`Resend: ${error.message}`);
}
