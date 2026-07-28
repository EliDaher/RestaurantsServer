import { ZodError } from "zod";
import { HttpError } from "../utils/http.js";
export function notFound(req, _res, next) {
    next(new HttpError(404, `Route not found: ${req.method} ${req.path}`));
}
export function errorHandler(error, _req, res, _next) {
    if (error instanceof ZodError) {
        return res.status(400).json({
            error: {
                message: "Validation failed",
                details: error.flatten()
            }
        });
    }
    if (error instanceof HttpError) {
        return res.status(error.status).json({
            error: {
                message: error.message,
                details: error.details
            }
        });
    }
    const firebaseError = getFirebaseServiceError(error);
    if (firebaseError) {
        console.error(error);
        return res.status(firebaseError.status).json({
            error: {
                message: firebaseError.message,
                details: firebaseError.details
            }
        });
    }
    console.error(error);
    return res.status(500).json({ error: { message: "Internal server error" } });
}
function getFirebaseServiceError(error) {
    if (!error || typeof error !== "object") {
        return null;
    }
    const candidate = error;
    if (candidate.reason === "SERVICE_DISABLED" || candidate.details?.includes("Cloud Firestore API")) {
        return {
            status: 503,
            message: "Cloud Firestore API is disabled for this Firebase project.",
            details: {
                action: "Enable Cloud Firestore API, then wait a few minutes and retry.",
                activationUrl: candidate.errorInfoMetadata?.activationUrl,
                service: candidate.errorInfoMetadata?.service,
                consumer: candidate.errorInfoMetadata?.consumer
            }
        };
    }
    if (candidate.code === 7 || candidate.code === "7") {
        return {
            status: 403,
            message: "Firebase rejected the request. Check Firestore permissions and service account access.",
            details: candidate.details
        };
    }
    return null;
}
