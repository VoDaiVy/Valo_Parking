import { apiFetch } from "./api";

const request = (path, options = {}) =>
  apiFetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${localStorage.getItem("accessToken")}` },
  });
const query = (params) =>
  new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== "" && value != null),
  ).toString();
export const getBookingFeedback = (id) =>
  request(`/bookings/${encodeURIComponent(id)}/feedback`);
export const submitBookingFeedback = (id, data) =>
  request(`/bookings/${encodeURIComponent(id)}/feedback`, {
    method: "POST",
    body: JSON.stringify(data),
  });
export const getAdminFeedbacks = (params = {}) =>
  request(`/admin/feedbacks?${query(params)}`);
export const getFeedbackStats = (params = {}) =>
  request(`/admin/feedbacks/stats?${query(params)}`);
export const getAdminFeedback = (id) =>
  request(`/admin/feedbacks/${encodeURIComponent(id)}`);
export const replyToFeedback = (id, data) =>
  request(`/admin/feedbacks/${encodeURIComponent(id)}/reply`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
export const setFeedbackPublication = (id, isPublic) =>
  request(`/admin/feedbacks/${encodeURIComponent(id)}/publication`, {
    method: "PUT",
    body: JSON.stringify({ isPublic }),
  });
