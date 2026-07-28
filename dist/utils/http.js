export class HttpError extends Error {
    status;
    details;
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}
export function sendJson(res, data, status = 200) {
    return res.status(status).json({ data });
}
