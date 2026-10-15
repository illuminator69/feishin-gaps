import { LbBotDownloadsPage } from '/@/renderer/features/lbbot/routes/lbbot-downloads-route';

/** The wishlist is the Downloads page's Wishlist section; this path opens it there. */
const LbBotWishlistRoute = () => <LbBotDownloadsPage initialSection="wishlist" />;

export default LbBotWishlistRoute;
