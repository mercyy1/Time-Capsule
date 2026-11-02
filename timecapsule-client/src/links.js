// Addresses of a capsule's pages. The public one is a full URL, to send to people.
export const capsulePath = (slug) => `/capsule/${slug}`;
export const shareUrl = (slug) => `${window.location.origin}/public/${slug}`;
