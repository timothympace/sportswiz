#!/bin/bash
####
#
# USAGE: matchup [-s sport] [-a teamA] [-b teamB] width height outfile
# USAGE: matchup [-help|-h]
#
# OPTIONS:
#
# -s     sport    Name of the sport league (i.e. NBA,NFL,MLB...)
#
# -a     teamA    Abbreviation for the visiting team.
#
# -b     teamB    Abbreviation for the home team.
#  
###
#
# NAME: MATCHUP 
# 
# PURPOSE: Creates a matchup PNG for two sports teams
# 
# DESCRIPTION: N/A
# 
# OPTIONS: 
# 
# -s sport ... A name of a sports league. This sports league will be used
#              to lookup the abbreviations used for teamA and teamB to find
#              their logos and team colors. Additionally, by specifying the
#              sport, the associations logo will appear in the bottom right
#              of the image.
#
# -a teamA ... The abbreviation for the visiting team of the matchup. This
#              abbreviation will be used to lookup the team logo within the
#              sports league specified. The logo will be superimposed on a
#              matchup backdrop and a color gradient using the teams colors
#              will be used to colorize the background.
#
# -b teamB ... The abbreviation for the home team of the matchup. This
#              abbreviation will be used to lookup the team logo within the
#              sports league specified. The logo will be superimposed on a
#              matchup backdrop and a color gradient using the teams colors
#              will be used to colorize the background.
######
#

PROGDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"    
PROGNAME=`basename ${BASH_SOURCE[0]}`
cd $PROGDIR

# Usage printers
usage() {
	echo >&2 ""
	echo >&2 "$PROGNAME:" "$@"
	sed  >&2 -e '1,/^####/d;  /^###/g;  /^#/!q;  s/^#//;  s/^ //;' "$PROGDIR/$PROGNAME"
}

usage_desc() {
	echo >&2 ""
	echo >&2 "$PROGNAME:" "$@"
	sed  >&2 -e '1,/^####/d;  /^######/g;  /^#/!q;  s/^#*//;  s/^ //;' "$PROGDIR/$PROGNAME"
}

# Error message printer
errMsg() {
	echo >&2 ""
	echo >&2 $1
	echo >&2 ""
	usage
	exit 1
}

checkOpt() {
	test=`echo "$1" | grep -c '^-.*$'`   # returns 1 if match; 0 otherwise
    [ $test -eq 1 ] && errMsg "$errorMsg"
}

# Parse CLI args.
if [ $# -eq 0 ]; then
    # help information
    echo ""
    usage_desc
    exit 0
elif [ $# -gt 12 ]; then
	errMsg "--- TOO MANY ARGUMENTS WERE PROVIDED ---"
else
	while [ $# -gt 0 ]
		do
			# get parameter values
			case "$1" in
                -help|-h)
                       # help information
					   echo ""
					   usage2
					   exit 0
					   ;;
                -a)
                       # Team A
                       shift
                       teamA=`echo $1 | tr '[:upper:]' '[:lower:]'`
                       ;;
                -b)
                       # Team A
                       shift
                       teamB=`echo $1 | tr '[:upper:]' '[:lower:]'`
                       ;;
                -s)
                       # get sport
					   shift  # to get the next parameter
					   # test if parameter starts with minus sign 
					   errorMsg="--- INVALID SPORT SPECIFICATION ---"
					   checkOpt "$1"
					   sport=`echo $1 | tr '[:upper:]' '[:lower:]'`
					   [ "$sport" = "" ] && errMsg "--- SPORT=$sport MUST BE TWO COLORS SEPARATED BY A DASH ---"
					   ;;
			 	-)    # STDIN and end of arguments
					   break
					   ;;
				-*)    # any other - argument
					   errMsg "--- UNKNOWN OPTION ---"
					   ;;
		     	*)     # end of arguments
					   break
					   ;;
			esac
			shift   # next option
	done
	#
	# get infile and outfile
    width="$1"
    height="$2"
	output="$3"
fi

# test that width is provided
[ "$width" = "" ] && errMsg "NO WIDTH SPECIFIED"

# test that height is provided
[ "$height" = "" ] && errMsg "NO HEIGHT SPECIFIED"

# test that output file is provided
[ "$output" = "" ] && errMsg "NO OUTPUT FILE SPECIFIED"


# Begin:

# What the final dimensions should be.
resize="${width}x${height}"

# Paths to logos.
basePath="../public/images/"
fileA=( ${teamA}* )
pathA="${sport^^}/${fileA[0]}"
fileB=( ${teamB}* )
pathB="${sport^^}/${fileB[0]}"
sportLogo="${sport^^}/${sport,,}.svg"

# Determine aspect ratio and validate if it is ok.
aspect=$(echo "scale=2; $width/$height" | bc -l)
if (( $(echo "$aspect < 0.5 || $aspect > 2.0" | bc -l) )); then
    errMsg "The image aspect ratio must be between 0.5 and 2.0"
fi

# Set the width and height of the image using the same aspect ratio
# but between 256 and 512 for the width or height.
if (( $(echo "$aspect >= 1.0" | bc -l) )); then
    height="256.00"
    width=$(echo "scale=2; $height*$aspect" | bc -l)
    scale=$(echo "scale=2; $width*.35" | bc -l)
    xTranslate=$(echo "scale=2; $width/4" | bc -l)
    yTranslate="0.00"
else
    width="256.00"
    height=$(echo "scale=2; $width/$aspect" | bc -l)
    scale=$(echo "scale=2; $height*.35" | bc -l)
    xTranslate="0.00"
    yTranslate=$(echo "scale=2; $height/4" | bc -l)
fi

# Line through the center starting at X1,Y1->X2,Y2
if (( $(echo "$width >= $height" | bc -l) )); then
    x1=$(echo "scale=2; ($width/2) - 20" | bc -l); y1=$height
    x2=$(echo "scale=2; ($width/2) + 20" | bc -l); y2="0.00"
else
    x1="0.00"; y1=$(echo "scale=2; ($height/2) + 20" | bc -l)
    x2=$width; y2=$(echo "scale=2; ($height/2) - 20" | bc -l)
fi

# Midpoint of X1,Y1->X2,Y2
xm=$(echo "scale=2; ($x1 + $x2) / 2" | bc -l)
ym=$(echo "scale=2; ($y1 + $y2) / 2" | bc -l)

# Perpendicular line GVX1,GVY1->GVX2,GVY2 to X1,Y1->X2,Y2 through XM,YM
gradslope=$(echo "scale=2; 1/(($y1-$y2)/($x2-$x1))" | bc -l)
gvx1=$(echo "scale=2; $xm+(-$ym/$gradslope)" | bc -l)
gvy1="0.00"
if (( $(echo "$gvx1 < 0" | bc -l) )); then
    gvx1="0.00"; gvy1=$(echo "scale=2; $ym+(-$xm*$gradslope)" | bc -l);
fi
gvx2=$(echo "scale=2; $xm+(($height-$ym)/$gradslope)" | bc -l)
gvy2=$height
if (( $(echo "$gvx2 > $width" | bc -l) )); then
    gvx2=$width; gvy2=$(echo "scale=2; $ym+(($width-$xm)*$gradslope)" | bc -l)
fi

# 1st Layer - Black canvas
layer1="-size ${width}x${height} canvas:black"

# 2nd Layer - Ellipse
radii=95
cx=$(echo "scale=2; $width/2" | bc -l)
cy=$(echo "scale=2; $height/2" | bc -l)
rx=$(echo "scale=2; $radii * $width / 200" | bc -l)
ry=$(echo "scale=2; $radii * $height / 200" | bc -l)
layer2="\( +clone -fill 'rgb(103,113,120)' -draw 'ellipse $cx,$cy $rx,$ry 0,360' -blur 0x50 -auto-level \) -compose blend -define compose:args=30,70 -composite"

# 3rd layer - Noise
layer3="\( +clone +level-colors GREY50 -attenuate 50 +noise Poisson -colorspace Gray -alpha on -channel a -evaluate set 50% \) -compose overlay -composite"

# 4th layer - Gradient
colorA=`eval "cat $sport.json | jq '.[] | select(.abbreviation == \"$teamA\") | .color'"`
colorB=`eval "cat $sport.json | jq '.[] | select(.abbreviation == \"$teamB\") | .color'"`
gradient="$colorA-$colorB"
layer4="\( -define gradient:vector=$gvx1,$gvy1,$gvx2,$gvy2 gradient:$gradient \) -define compose:args=15 -compose blend -composite"

# 5th layer - Line
seg1_grad="\( canvas:none -define gradient:vector=$x1,$y1,$xm,$ym gradient:gray-black \)"
seg1_mask="\( canvas:none -stroke white -strokewidth 3 -draw 'line $x1,$y1 $xm,$ym' \)"
seg1="$seg1_grad $seg1_mask -composite"
seg2_grad="\( canvas:none -define gradient:vector=$xm,$ym,$x2,$y2 gradient:black-gray \)"
seg2_mask="\( canvas:none -stroke white -strokewidth 3 -draw 'line $xm,$ym $x2,$y2' \)"
seg2="$seg2_grad $seg2_mask -composite"
line="\( $seg1 \) \( $seg2 \) -compose overlay -composite -blur 0x.5"
layer5="\( $line \) -compose overlay -composite"

# 6th layer - Text
layer6="\( canvas:none -fill 'rgba(194,195,197,0.35)' -strokewidth 1.1 -stroke black -pointsize 26 -font 'Helvetica-Bold' -gravity center -annotate +0+0 'AT' -blur 0x.5 \) -compose over -composite"

# 7th layer - Sport logo
if [ "$sportLogo" != "" ]; then
    layer7="\( $sportLogo -gravity SouthEast -resize '12%' -geometry +5+5 \) -compose over -composite"
else
    layer7=""
fi

# 8th layer - Team A Logo
if [ "$pathA" != "" ]; then
    layer8outline="\( $pathA -alpha extract -morphology edge octagon -threshold 5% -transparent black -fill 'rgba(0,0,0,0.4)' -opaque white -blur 0x1 \)"
    layer8comb="$layer8outline $pathA -compose over -composite"
    layer8="\( $layer8comb -gravity Center -geometry ${scale}x${scale}-$xTranslate-$yTranslate \) -compose over -composite"
else
    layer8=""
fi

# 9th layer - Team B Logo
if [ "$pathB" != "" ]; then
    layer9outline="\( $pathB -alpha extract -morphology edge octagon -threshold 5% -transparent black -fill 'rgba(0,0,0,0.4)' -opaque white -blur 0x1 \)"
    layer9comb="$layer9outline $pathB -compose over -composite"
    layer9="\( $layer9comb -gravity Center -geometry ${scale}x${scale}+$xTranslate+$yTranslate \) -compose over -composite" 
else
    layer9=""
fi

# Build the command
cmd="convert $layer1 $layer2 $layer3 $layer4 $layer5 $layer6 $layer7 $layer8 $layer9 -resize $resize $output"

# Evaluate the command
eval $cmd
