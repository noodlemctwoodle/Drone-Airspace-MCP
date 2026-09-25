# Public rights of way via rowmaps.com

Each council releases its rights-of-way GIS data under the Open Government
Licence v3 (a few older releases used OS OpenData terms). rowmaps.com converts
them to GeoJSON and states per file:

> The data in this GeoJSON file has been obtained under licence from the council
> of X. The Council's Definitive Map is the authoritative source of their rights
> of way. The details of the public rights of way network contained in the
> Council's data are for information only, and are an interpretation of the
> Definitive Map, not the Definitive Map itself ... The authority's data contains
> Ordnance Survey data © Crown copyright and database right <year>. ... Data is
> also provided by www.rowmaps.com © www.rowmaps.com copyright and database
> right <year>. This file is released with the Open Government Licence. The
> preceding attribution statements must be contained in any sub-licences.

The pack stores one attribution string per authority (`authorities.attribution`)
and `check_takeoff_site` prints the attribution of every authority whose paths
appear in a response. See <https://www.opennetzero.org/> and
<https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/>.
