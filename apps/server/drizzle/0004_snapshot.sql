CREATE TABLE "snapshot" (
	"version" bigserial PRIMARY KEY NOT NULL,
	"bytes" "bytea" NOT NULL,
	"byte_length" integer NOT NULL,
	"sha256" text NOT NULL,
	"schema_version" integer NOT NULL,
	"origin" text NOT NULL,
	"device_id" text,
	"base_version" integer,
	"created_at" timestamp with time zone NOT NULL
);
