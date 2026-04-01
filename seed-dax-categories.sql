-- DAX subcategories under Power BI
-- Run with: npx wrangler d1 execute sp1e-db --remote --file=seed-dax-categories.sql

INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-revenue',   'power-bi', 'Revenue & Financial KPIs',  5);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-orders',    'power-bi', 'Orders & Bookings',          6);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-customers', 'power-bi', 'Customer Analytics',         7);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-workforce', 'power-bi', 'Workforce & Operations',     8);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-geo',       'power-bi', 'Geographic Analysis',        9);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-rut',       'power-bi', 'RUT-Specific',              10);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-seasonal',  'power-bi', 'Seasonal & Trend',          11);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-marketing', 'power-bi', 'Marketing & Acquisition',   12);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-quality',   'power-bi', 'Quality & Complaints',      13);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-forecast',  'power-bi', 'Forecasting & Targets',     14);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-ranking',   'power-bi', 'Comparative & Ranking',     15);
INSERT OR IGNORE INTO subcategories (id, category_id, name, sort_order) VALUES ('pb-utility',   'power-bi', 'Helper / Utility',          16);
