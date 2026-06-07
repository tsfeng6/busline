CREATE TABLE "submissions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"city" varchar(255) NOT NULL,
	"area" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"creator_nickname" varchar(255) NOT NULL,
	"path" json DEFAULT '[]'::json,
	"via_stops" json DEFAULT '[]'::json,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
