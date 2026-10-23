CREATE TABLE "area_grid_cell" (
	"area_id" text NOT NULL,
	"col" integer NOT NULL,
	"row" integer NOT NULL,
	CONSTRAINT "area_grid_cell_area_id_col_row_pk" PRIMARY KEY("area_id","col","row")
);
--> statement-breakpoint
ALTER TABLE "area_grid_cell" ADD CONSTRAINT "area_grid_cell_area_id_area_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."area"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "area" DROP COLUMN "map_ref";