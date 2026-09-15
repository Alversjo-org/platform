const shell = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1>${body}</body>`;

export const forbiddenPageHtml = () => shell('No access', '<p>You do not have access to this box. Ask an admin to share it with you.</p>');

export const stoppedPageHtml = (canStart: boolean, platformUrl: string, boxId: string) =>
  shell('Box is not running', canStart
    ? `<p>This box is stopped. <a href="${platformUrl}/boxes/${boxId}">Start it from the platform</a>, then come back.</p>`
    : '<p>This box is stopped. Ask an admin to start it.</p>');

export const notFoundPageHtml = () => shell('Unknown box', '<p>There is no box at this address.</p>');

export const notReadyPageHtml = () => shell('Box is starting', '<p>The box is starting up and has not finished its first boot yet. Try again in a minute.</p>');
