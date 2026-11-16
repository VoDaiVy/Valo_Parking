import { useEffect, useRef, useState } from "react";
import { useSocket } from "../../hooks/useSocket";
import {
  getBookingFeedback,
  submitBookingFeedback,
} from "../../services/feedbackService";

const categories = {
  parking: "Parking space",
  staff: "Staff",
  payment: "Payment",
  app: "Application",
  other: "Other",
};
const date = (value) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh" });

export default function BookingFeedbackModal({
  booking,
  onClose,
  onSubmitted,
  refreshKey,
}) {
  const socket = useSocket();
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [selected, setSelected] = useState([]);
  const dialog = useRef(null);
  const savingRef = useRef(false);
  const loadedRef = useRef(false);
  const requestRef = useRef(0);
  useEffect(() => {
    const previous = document.activeElement;
    const node = dialog.current;
    node.showModal();
    return () => {
      node.close();
      previous?.focus?.();
    };
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (savingRef.current) return;
      const request = ++requestRef.current;
      const res = await getBookingFeedback(booking._id);
      if (!active || request !== requestRef.current) return;
      if (res.ok) {
        loadedRef.current = true;
        setFeedback(res.data.data);
        setLoadFailed(false);
      } else {
        if (!loadedRef.current) setLoadFailed(true);
        setError(res.data?.message || "Could not load feedback.");
      }
      setLoading(false);
    };
    const onNotification = (notification) => {
      if (
        notification?.metadata?.eventType === "BOOKING_FEEDBACK_REPLIED" &&
        String(notification.metadata.bookingId) === String(booking._id)
      )
        refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    socket?.on("notification:new", onNotification);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
      socket?.off("notification:new", onNotification);
    };
  }, [booking._id, socket, refreshKey]);
  const submit = async (event) => {
    event.preventDefault();
    if (!rating) {
      setError("Choose a rating from 1 to 5 stars.");
      return;
    }
    setSaving(true);
    savingRef.current = true;
    requestRef.current++;
    setError("");
    const res = await submitBookingFeedback(booking._id, {
      rating,
      comment: comment.trim(),
      categories: selected,
    });
    if (res.ok) {
      setFeedback(res.data.data);
      onSubmitted?.();
    } else if (res.status === 409) {
      const latest = await getBookingFeedback(booking._id);
      if (latest.ok && latest.data.data) {
        setFeedback(latest.data.data);
        onSubmitted?.();
      } else
        setError(
          res.data?.message ||
            "This booking has already been reviewed. Refresh to view it.",
        );
    } else
      setError(
        res.data?.message ||
          "Could not send feedback. Your draft is preserved.",
      );
    setSaving(false);
    savingRef.current = false;
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="feedback-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-white/15 bg-[#111915] p-6 text-white shadow-2xl backdrop:bg-black/75"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id="feedback-title" className="text-xl font-bold">
            Booking feedback
          </h2>
          <p className="mt-1 break-all text-xs text-white/50">
            Booking {booking._id}
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={onClose}
          className="rounded-lg border border-white/15 px-3 py-2 text-sm"
        >
          Close
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-rose-500/10 p-3 text-sm text-rose-300"
        >
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading feedback…</p>
      ) : feedback ? (
        <div className="space-y-5">
          <div>
            <p
              className="text-lg font-bold text-yellow-300"
              aria-label={`${feedback.rating} out of 5 stars`}
            >
              {"★".repeat(feedback.rating)}
              {"☆".repeat(5 - feedback.rating)}
            </p>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm">
              {feedback.comment || "No written comment."}
            </p>
            <p className="mt-2 text-xs text-white/50">
              {(feedback.categories || [])
                .map((item) => categories[item] || item)
                .join(" · ")}
            </p>
          </div>
          <section className="border-t border-white/10 pt-4">
            <h3 className="font-bold">Valo Parking response</h3>
            {feedback.reply ? (
              <>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white/80">
                  {feedback.reply.content}
                </p>
                <p className="mt-3 text-xs text-white/40">
                  Updated{" "}
                  {date(feedback.reply.updatedAt || feedback.reply.repliedAt)}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-white/50">
                Thank you for your feedback. Awaiting a response.
              </p>
            )}
          </section>
        </div>
      ) : loadFailed ? null : booking.canSubmitFeedback ? (
        <form onSubmit={submit} className="space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">
              How was your parking experience?
            </legend>
            <div className="flex gap-3">
              {[1, 2, 3, 4, 5].map((value) => (
                <label
                  key={value}
                  className="cursor-pointer text-3xl text-yellow-300"
                >
                  <input
                    type="radio"
                    name="rating"
                    value={value}
                    checked={rating === value}
                    onChange={() => setRating(value)}
                    aria-label={`${value} star${value > 1 ? "s" : ""}`}
                    className="sr-only peer"
                  />
                  <span className="rounded peer-focus-visible:outline peer-focus-visible:outline-2">
                    {value <= rating ? "★" : "☆"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">
              Topics (optional)
            </legend>
            <div className="flex flex-wrap gap-3">
              {Object.entries(categories).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(value)}
                    onChange={() =>
                      setSelected((items) =>
                        items.includes(value)
                          ? items.filter((item) => item !== value)
                          : [...items, value],
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-sm font-semibold">
            Your comments (optional)
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={1000}
              rows={4}
              className="mt-2 w-full rounded-xl border border-white/20 bg-black/20 p-3 font-normal"
            />
            <span className="text-xs text-white/40">{comment.length}/1000</span>
          </label>
          <p className="text-xs text-white/50">
            Your feedback is private to you and the admin team. It cannot be
            edited after sending.
          </p>
          <button
            disabled={saving}
            className="w-full rounded-xl bg-yellow-300 px-4 py-3 font-bold text-black disabled:opacity-50"
          >
            {saving ? "Sending…" : "Send feedback"}
          </button>
        </form>
      ) : (
        <p className="text-sm text-white/60">
          Only the owner of a completed booking can submit feedback.
        </p>
      )}
    </dialog>
  );
}
